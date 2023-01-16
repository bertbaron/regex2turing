class Expression {
    constructor(expression, alphabet, accept, reject, mode) {
        this.expression = expression
        this.alphabet = alphabet
        this.accept = accept
        this.reject = reject
        this.mode = mode
    }
}
var debug = false
function setDebug(value) {
    debug = value
}

var nfaStateCounter = 0
class NFAState {
    static terminal(char) {
        return new NFAState(char, [], true)
    }
    static lambda(children, open) {
        return new NFAState(null, children, open)
    }
    constructor(char, children, open) {
        this.char = char
        this.children = children
        this.id = nfaStateCounter++
        this.open = open
    }
    isGoal() {
        return this.open
    }
    toString() {
        let c = this.char ? this.char : 'λ'
        let out = this.children.map((c) => c.id)
        if (this.open) out.push('⊙')
        return `${this.id} (${c}→${out.join()})`
    }
    doSetOutput(next, visited) {
        if (visited.has(this.id)) return
        visited.add(this.id)
        this.children.forEach((c) => c.doSetOutput(next, visited))
        if (this.open) {
            this.children.push(next)
            this.open = false
        }
    }
    setOutput(next) {
        let visited = new Set([])
        this.doSetOutput(next, visited)
    }
    doClone(clonedMap) {
        if (clonedMap.has(this)) {
            return clonedMap.get(this)
        }
        let clonedChildren = []
        let clone = new NFAState(this.char, clonedChildren, this.open)
        clonedMap.set(this, clone)
        for (let child of this.children) {
            clonedChildren.push(child.doClone(clonedMap))
        }
        return clone
    }
    clone() {
        return this.doClone(new Map())
    }
}

class DFAState {
    constructor(isGoal) {
        this.id = -1
        this.goal = isGoal
        this.next = new Map()
    }
    addTransition(symbol, dfaState) {
        this.next.set(symbol, dfaState)
    }
    isGoal() {
        return this.goal
    }
}

const SELF = 'self'
const NEXT = 'next'

class TuringTransition {
    constructor(read, write, move, next) {
        this.read = read
        this.write = write
        this.move = move
        this.next = next
    }
}

class TuringState {
    constructor(name) {
        this.name = name
        this.comments = []
        this.transitions = []
    }

    addComment(comment) {
        this.comments.push(comment)
    }

    addTransition(read, write, move, next) {
        if (typeof next !== 'string') {
            next = next.name
        } else if (next == SELF) {
            next = this.name
        } else if (next == NEXT) {
            const indexOfNumberSuffix = this.name.search(/\d+$/)
            const number = this.name.substring(indexOfNumberSuffix)
            next = this.name.replace(number, Number(number) + 1)
        }
        this.transitions.push(new TuringTransition(read, write, move, next))
    }
}

class TuringMachine {
    constructor(comments, description, initialState, acceptState) {
        this.comments = comments
        this.description = description
        this.initialState = initialState
        this.acceptState = acceptState
        this.states = []
    }

    addStates(states) {
        this.states.push(...states)
    }
}

const TOKENSTATE_GLOBAL = 0
const TOKENSTATE_CHARCLASS = 1
class Parser {
    constructor(expression) {
        this.expr = expression.expression
        if (expression.mode == 'contains') {
            if (!expression.alphabet) {
                throw "Alphabet must be specified for 'contains'"
            }
            this.expr = `.*(${this.expr})`
        }
        this.alphabet = expression.alphabet
        this.index = 0
        this.token = null
        this.tokenState = TOKENSTATE_GLOBAL
    }

    clean(t) {
        return t.length > 1 ? t.substring(1) : t
    }

    fail(message) {
        throw `Parsing error at index ${this.index}: ${message}`
    }

    end() {
        return this.token == null && this.index == this.expr.length
    }

    checkEndOfInput(expected) {
        if (this.end()) this.fail(`Unexpected end of input, expected ${expected}`)
    }

    fetchNextToken() {
        let operators = this.tokenState == TOKENSTATE_GLOBAL ? '|()*+?[].{}' : '[]-^'
        if (this.index == this.expr.length) {
            fail('Assertion error: end of input')
        }
        let c = this.expr.charAt(this.index++)
        if (c == '\\') {
            if (this.index == this.expr.length) {
                fail('Expected escaped character but end of input found')
            }
            c = this.expr.charAt(this.index++)
            this.token = c
        } else if (operators.indexOf(c) > -1) {
            this.token = '.' + c
        } else {
            this.token = c
        }
        if (this.tokenState == TOKENSTATE_GLOBAL && this.token == '.[') {
            this.tokenState = TOKENSTATE_CHARCLASS
        }
        if (this.tokenState == TOKENSTATE_CHARCLASS && this.token == '.]') {
            this.tokenState = TOKENSTATE_GLOBAL
        }
    }

    peek() {
        if (this.token == null && this.index < this.expr.length) this.fetchNextToken()
        return this.token
    }

    pop() {
        this.checkEndOfInput('more input')
        let token = this.peek()
        this.token = null
        return token
    }

    popExpect(expected) {
        let exp = expected.length == 1 ? this.clean(expected[0]) : 'one of ' + expected.map(this.clean).join(', ')
        this.checkEndOfInput(`${exp}`)
        let token = this.peek()
        if (!expected.includes(token)) {
            this.fail(`Unexpected token: ${this.clean(token)}, expected ${exp}`)
        }
        return this.pop()
    }

    getAlphabet(reason) {
        if (!this.alphabet) {
            this.fail(`An explicit alphabet is required for ${reason}`)
        }
        return this.alphabet.split('')
    }

    parseCharacterClass() {
        let next = this.pop()
        let characters = []
        let complement = false
        if (next == '.^') {
            complement = true
            next = this.pop()
        }
        while (next != '.]') {
            if (next == '.-') {
                let start = characters.pop(next)
                next = this.pop()
                if (next.length > 1) {
                    this.fail(`Operator not allowed in character class (range): ${this.clean(next)}`)
                }
                let size = 0
                for (let c = start; c <= next; c = String.fromCharCode(c.charCodeAt(0) + 1)) {
                    characters.push(c)
                    size++
                    if (size > 1000) {
                        this.fail(`Character range too large: [${start}-${next}]`)
                    }
                }
                next = this.pop()
            } else {
                if (next == '.^') next = '^'
                if (next.length > 1) {
                    this.fail(`Operator not allowed in character class: ${this.clean(next)}`)
                }
                characters.push(next)
                next = this.pop()
            }
        }
        if (characters.length == 0) {
            this.fail(`Empty character class is not allowed`)
        }
        if (complement) {
            let alphabet = new Set(this.getAlphabet('^ character class'))
            characters.forEach((c) => alphabet.delete(c))
            characters = alphabet
        }
        return NFAState.lambda(
            Array.from(new Set(characters)).map((c) => NFAState.terminal(c)),
            false
        )
    }

    parsePrimary() {
        this.checkEndOfInput('a primary')
        let next = this.peek()
        if (next.length == 1) {
            this.pop()
            return NFAState.terminal(next)
        } else if (next == '.(') {
            this.pop()
            let expr = this.parseExpression()
            this.popExpect(['.)'])
            return expr
        } else if (next == '.[') {
            this.pop()
            return this.parseCharacterClass()
        } else if (next == '..') {
            this.pop()
            let alphabet = this.getAlphabet('the . operator')
            let children = []
            for (let c of alphabet) {
                children.push(NFAState.terminal(c))
            }
            return NFAState.lambda(children, false)
        }
        this.fail(`Unexpected token: ${this.clean(next)}`)
    }

    parseRepetitionModifier(p1) {
        let modifier = ''
        let token = this.pop()
        while (token != '.}') {
            modifier += token
            token = this.pop()
        }
        let match = /^(\d+)(,(\d+)?)?$/.exec(modifier)
        if (!match) {
            this.fail(`Invalid repetition modifier: {${modifier}}`)
        }
        let start = parseInt(match[1])
        let end = start
        if (match[2] && !match[3]) {
            end = null // infinity
        } else if (match[3]) {
            end = parseInt(match[3])
        }
        let expr = NFAState.lambda([], true)
        let lastElement = expr
        for (let i = 0; i < start; i++) {
            let clone = p1.clone()
            expr.setOutput(clone)
            lastElement = clone
        }
        if (end) {
            let tail = NFAState.lambda([], true)
            for (let i = start; i < end; i++) {
                let clone = p1.clone()
                clone.setOutput(tail)
                tail = NFAState.lambda([clone], true)
            }
            expr.setOutput(tail)
        } else {
            let q = NFAState.lambda([lastElement], true)
            expr.setOutput(q)
        }
        return expr
    }

    parseUnary() {
        let p1 = this.parsePrimary()
        let next = this.peek()
        switch (next) {
            case '.*': {
                this.pop()
                let lambda = NFAState.lambda([p1], true)
                p1.setOutput(lambda)
                return lambda
            }
            case '.+': {
                this.pop()
                let lambda = NFAState.lambda([p1], true)
                p1.setOutput(lambda)
                return p1
            }
            case '.?': {
                this.pop()
                return NFAState.lambda([p1], true)
            }
            case '.{': {
                this.pop()
                return this.parseRepetitionModifier(p1)
            }
        }
        return p1
    }

    parseConcat() {
        let p1 = this.parseUnary()
        let next = this.peek()
        if (next && (next.length == 1 || next == '.(' || next == '.[' || next == '..')) {
            let p2 = this.parseConcat()
            p1.setOutput(p2)
        }
        return p1
    }

    parseExpression() {
        let p1 = this.parseConcat()
        if (this.peek() == '.|') {
            this.pop()
            let p2 = this.parseExpression()
            return NFAState.lambda([p1, p2], false)
        }
        return p1
    }

    parse() {
        let result = this.parseExpression()
        if (!this.end) {
            this.fail('Unexpected trailing characters')
        }
        return result
    }
}

class NFA2DFAState {
    constructor(nfaStates) {
        this.nfaStates = nfaStates
        this.key = nfaStates
            .map((s) => s.id)
            .sort()
            .join()
        const isGoal = nfaStates.some((s) => s.isGoal())
        this.dfaState = new DFAState(isGoal)
    }
}

function nfaClosure(states) {
    let stateIds = new Set([])
    let todo = states.slice(0)
    let closure = []
    while (todo.length > 0) {
        let s = todo.pop()
        closure.push(s)
        for (let child of s.children.filter((c) => !(c.char || stateIds.has(c.id)))) {
            stateIds.add(child.id)
            todo.push(child)
        }
    }
    return closure
}

function goTo(nfaStates, symbol) {
    return nfaClosure(nfaStates.flatMap((state) => state.children.filter((child) => child.char == symbol)))
}

// returns the Set of symbols accepted by the given list of states
function getSymbols(nfaStates) {
    let childSet = nfaStates.flatMap((state) => state.children)
    return new Set(childSet.map((state) => state.char).filter((symbol) => symbol))
}

function nfa2dfaSub(dfaSet, nfa2dfaState) {
    dfaSet.push(nfa2dfaState)
    let symbols = getSymbols(nfa2dfaState.nfaStates)

    for (let symbol of symbols) {
        let targets = goTo(nfa2dfaState.nfaStates, symbol)
        let newState = new NFA2DFAState(targets)
        let existing = false
        for (let curState of dfaSet.filter((c) => c.key == newState.key)) {
            newState = curState
            existing = true
        }
        nfa2dfaState.dfaState.addTransition(symbol, newState.dfaState)
        if (!existing) {
            nfa2dfaSub(dfaSet, newState)
        }
    }
}

function nfa2dfa(nfa) {
    let stateSet = nfaClosure([NFAState.lambda([nfa], false)])
    let dfa = []
    nfa2dfaSub(dfa, new NFA2DFAState(stateSet))
    for (let i = 0; i < dfa.length; i++) {
        dfa[i].dfaState.id = i
    }
    return dfa.map((s) => s.dfaState)
}

function minimizeDfa(dfa) {
    // remove unreachable states
    let reachable = new Set([dfa[0]])
    let todo = [dfa[0]]
    while (todo.length > 0) {
        let state = todo.pop()
        for (let next of state.next.values()) {
            if (!reachable.has(next)) {
                reachable.add(next)
                todo.push(next)
            }
        }
    }
    dfa = dfa.filter((s) => reachable.has(s))

    let partitions = [[], []]
    for (let state of dfa) {
        partitions[state.goal ? 1 : 0].push(state)
    }
    debug && console.log('Minimizing DFA')
    changed = true
    while (changed) {
        debug && console.log(`  partitions: ${partitions.map((p) => p.map((s) => s.id).join(',')).join(' | ')}`)
        changed = false
        newPartitions = []
        for (let partition of partitions) {
            let partCopy = partition.slice(0)
            while (partCopy.length > 0) {
                let state = partCopy.shift()
                let newPartition = [state]
                for (let i = 0; i < partCopy.length; i++) {
                    let other = partCopy[i]
                    let same = true
                    if (state.next.size != other.next.size) {
                        same = false
                    } else {
                        for (let [symbol, next] of state.next) {
                            // get the partition index of the next state in partitions
                            let index = partitions.findIndex((p) => p.includes(next))
                            let otherIndex = partitions.findIndex((p) => p.includes(other.next.get(symbol)))
                            if (index != otherIndex) {
                                same = false
                                break
                            }
                        }
                    }
                    if (same) {
                        newPartition.push(other)
                        partCopy.splice(i, 1)
                        i--
                    }
                }
                newPartitions.push(newPartition)
                if (partCopy.length > 0) {
                    changed = true
                }
            }
        }
        partitions = newPartitions
    }

    let newDfa = partitions.map((p) => new DFAState(p[0].isGoal()))
    for (let i=0; i<partitions.length; i++) {
        partition = partitions[i]
        let newDfaState = newDfa[i]
        newDfaState.id = i
        for (let [symbol, next] of  partition[0].next) {
            let index = partitions.findIndex((p) => p.includes(next))
            newDfaState.addTransition(symbol, newDfa[index])
        }
    }
    return newDfa    
}

function removeTransationsFromGoalStates(dfa) {
    // we should make a modified copy of the dfa, but we can get away with modifying the original for now
    for (let state of dfa) {
        if (state.isGoal()) {
            state.next.clear()
        }
    }
    return dfa
}

function printNfa(nfa) {
    let set = new Set([nfa.id])
    let todo = [nfa]
    let result = new Map()
    while (todo.length > 0) {
        let state = todo.pop()
        result.set(state.id, state)
        state.children.forEach((child) => {
            if (!set.has(child.id)) {
                set.add(child.id)
                todo.push(child)
            }
        })
    }

    function sortId(id) {
        return id == nfa.id ? -9999 : id
    }
    let stateNumbers = [...result.keys()].sort((a,b) => sortId(a) - sortId(b))
    console.log('NFA:')
    for (let state of stateNumbers) {
        let prefix = ' '.repeat(2 - state.toString().length)
        console.log(` ${prefix}${result.get(state)}`)
    }
}

function printDfa(title, dfa) {
    console.log(`${title}: (${dfa.length} states)`)
    for (let state of dfa) {
        let suffix = state.isGoal() ? ' ⊙ ' : '   '
        console.log(`  ${state.id}${suffix}`)
        for (let [symbol, next] of state.next.entries()) {
            console.log(`    ${symbol} -> ${next.id}`)
        }
    }
}

function turingMachineForMatch(dfa, expression) {
    let prefix = 'regex'
    let acceptState = expression.accept || `${prefix}_accept`
    let rejectState = expression.reject
    let alphabet = expression.alphabet ? new Set(expression.alphabet.split('')) : null
    if (rejectState && !alphabet) {
        throw 'An explicit alphabet is required when a reject state is given'
    }

    let turingMachine = new TuringMachine(
        ['generated by regex2turing:', 'https://bertbaron.github.io/regex2turing/'],
        `Accepts inputs matching regex '${expression.expression}'`,
        `${prefix}0`,
        `${acceptState}`
    )

    let turingStates = []

    for (let state of dfa) {
        let turingState = new TuringState(`${prefix}${state.id}`)
        let symbols = new Set([])
        for (let [symbol, next] of state.next.entries()) {
            turingState.addTransition(symbol, symbol, '>', `${prefix}${next.id}`)
            symbols.add(symbol)
        }
        if (rejectState) {
            for (let symbol of alphabet) {
                if (!symbols.has(symbol)) {
                    turingState.addTransition(symbol, symbol, '<', rejectState)
                }
            }
        }

        if (state.isGoal()) {
            turingState.addTransition(' ', ' ', '<', acceptState)
        }
        turingStates.push(turingState)
    }
    turingMachine.addStates(turingStates)
    return turingMachine
}

function turingMachineForContains(dfa, expression) {
    let prefix = 'regex'
    let acceptState = expression.accept || `${prefix}_accept`
    let rejectState = expression.reject
    let alphabet = expression.alphabet ? new Set(expression.alphabet.split('')) : null
    if (rejectState && !alphabet) {
        throw 'An explicit alphabet is required when a reject state is given'
    }

    let turingMachine = new TuringMachine(
        ['generated by regex2turing:', 'https://bertbaron.github.io/regex2turing/'],
        `Accepts inputs with substring matching regex '${expression.expression}'`,
        `${prefix}0`,
        `${acceptState}`
    )

    let turingStates = []

    for (let state of dfa) {
        let turingState = new TuringState(`${prefix}${state.id}`)
        let symbols = new Set([])
        if (state.isGoal()) {
            for (let symbol of expression.alphabet + ' ') {
                turingState.addTransition(symbol, symbol, '<', acceptState)
            }
        } else {
            for (let [symbol, next] of state.next.entries()) {
                turingState.addTransition(symbol, symbol, '>', `${prefix}${next.id}`)
                symbols.add(symbol)
            }
            if (rejectState) {
                turingState.addTransition(' ', ' ', '<', rejectState)
            }
        }

        turingStates.push(turingState)
    }
    turingMachine.addStates(turingStates)
    return turingMachine
}

function turingMachineForFind(dfa, expression) {
    // let prefix = 'regex_'
    let prefix = ''
    let acceptState = expression.accept || `${prefix}accept`
    let rejectState = expression.reject
    let alphabet = expression.alphabet ? new Set(expression.alphabet.split('')) : null
    if (!alphabet) {
        throw 'An explicit alphabet is required for find'
    }
    if (dfa[0].isGoal()) {
        throw 'Expression matches empty string (not supported for find)'
    }

    // Make a set of symbols that can mark the end of a match. This can be used to remove characters
    // from the end of a string in a more efficient way in many cases.
    let endSymbols = new Set()
    for (let fromState of dfa) {
        for (let [symbol, toState] of fromState.next) {
            if (toState.isGoal()) {
                endSymbols.add(symbol)
            }
        }
    }

    let turingMachine = new TuringMachine(
        ['generated by regex2turing:', 'https://bertbaron.github.io/regex2turing/'],
        `Accepts inputs containing regex '${expression.expression}', selecting the first match (removing the rest)`,
        `${prefix}find0`,
        `${acceptState}`
    )

    find_first_match = []
    find_longer_match = []

    // Add states driven by the DFA
    for (let state of dfa) {
        let symbols = new Set([])
        first_match_state = new TuringState(`${prefix}find${state.id}`)
        longer_match_state = new TuringState(`${prefix}match${state.id}`)
        if (!state.isGoal()) {
            for (let [symbol, next] of state.next.entries()) {
                first_match_state.addTransition(symbol, symbol, '>', `${prefix}find${next.id}`)
                longer_match_state.addTransition(symbol, symbol, '>', `${prefix}match${next.id}`)
                symbols.add(symbol)
            }
            for (let symbol of alphabet) {
                if (!symbols.has(symbol)) {
                    first_match_state.addTransition(symbol, symbol, '<', `${prefix}strip_start0`)
                    longer_match_state.addTransition(symbol, ' ', '>', `${prefix}strip_end1`)
                }
            }
            longer_match_state.addTransition(' ', ' ', '<', `${prefix}strip_end0`)
        }

        if (state.isGoal()) {
            for (let [symbol, next] of state.next.entries()) {
                first_match_state.addTransition(symbol, symbol, '>', `${prefix}match${next.id}`)
                longer_match_state.addTransition(symbol, symbol, '>', `${prefix}match${next.id}`)
                symbols.add(symbol)
            }
            for (let symbol of alphabet) {
                if (!symbols.has(symbol)) {
                    first_match_state.addTransition(symbol, ' ', '>', `${prefix}strip_end1`)
                    longer_match_state.addTransition(symbol, ' ', '>', `${prefix}strip_end1`)
                }
            }
            first_match_state.addTransition(' ', ' ', '<', `${prefix}accept`)
            longer_match_state.addTransition(' ', ' ', '<', `${prefix}accept`)
        }
        find_first_match.push(first_match_state)
        find_longer_match.push(longer_match_state)
    }
    if (rejectState) {
        find_first_match[0].addTransition(' ', ' ', '<', rejectState)
    }

    // Add the generic states

    find_match_failed = [new TuringState(`${prefix}strip_start0`), new TuringState(`${prefix}strip_start1`)]
    find_longer_match_failed = [
        new TuringState(`${prefix}strip_end0`),
        new TuringState(`${prefix}strip_end1`),
        new TuringState(`${prefix}strip_end2`),
        new TuringState(`${prefix}strip_end3`),
    ]
    for (let symbol of alphabet) {
        find_match_failed[0].addTransition(symbol, symbol, '<', SELF)
        find_longer_match_failed[0].addTransition(symbol, ' ', '<', find_longer_match_failed[2])
        find_longer_match_failed[1].addTransition(symbol, ' ', '>', SELF)
        find_match_failed[1].addTransition(symbol, ' ', '>', `${prefix}find0`)
        if (endSymbols.has(symbol)) {
            find_longer_match_failed[2].addTransition(symbol, symbol, '<', NEXT)
        } else {
            find_longer_match_failed[2].addTransition(symbol, ' ', '<', SELF)
        }
        find_longer_match_failed[3].addTransition(symbol, symbol, '<', SELF)
    }
    find_match_failed[0].addTransition(' ', ' ', '>', NEXT)
    find_longer_match_failed[1].addTransition(' ', ' ', '<', NEXT)
    find_longer_match_failed[2].addTransition(' ', ' ', '<', SELF)
    find_longer_match_failed[3].addTransition(' ', ' ', '>', `${prefix}find0`)

    find_first_match[0].comments = ['', 'find first match']
    turingMachine.addStates(find_first_match)
    find_match_failed[0].comments = ['', 'match failed, remove first character and try again']
    turingMachine.addStates(find_match_failed)
    find_longer_match[0].comments = ['', 'match found, find longer match']
    turingMachine.addStates(find_longer_match)
    find_longer_match_failed[0].comments = ['', 'match failed but shorter match found, remove trailing and try again']
    turingMachine.addStates(find_longer_match_failed)

    return turingMachine
}

function toTuringMachine(dfa, expression) {
    switch (expression.mode) {
        case 'match':
            return turingMachineForMatch(dfa, expression)
        case 'contains':
            return turingMachineForContains(dfa, expression)
        case 'find':
            return turingMachineForFind(dfa, expression)
        default:
            throw `Unknown mode ${expression.mode}`
    }
}

function expandAlphabet(alphabet) {
    // (ab)use the parser to parse the alphabet in character-class syntax
    if (alphabet.charAt(0) == '^') {
        alphabet = '\\' + alphabet
    }
    const alphabetExpression = new Expression(`${alphabet}]`)
    const parser = new Parser(alphabetExpression)
    parser.tokenState = TOKENSTATE_CHARCLASS
    const cclass = parser.parseCharacterClass()
    let result = ''
    for  (let child of cclass.children) {
        result += child.char
    }
    return result
}

function compileExpression(expression) {
    if (expression.mode == 'find' && !expression.alphabet) {
        throw `An explicit alphabet is required by the find option`
    }
    // [a-d] -> [abcd]. Not the best place to do this, but it works.
    if (expression.alphabet) {
        expression.alphabet = expandAlphabet(expression.alphabet)
    }
    let parser = new Parser(expression)
    let nfa = parser.parse()
    debug && printNfa(nfa)
    let dfa = nfa2dfa(nfa)
    debug && printDfa('DFA', dfa)

    // If mode is 'contains', remove outgoing states from the goal states to reduce the number of states
    if (expression.mode == 'contains') {
        dfa = removeTransationsFromGoalStates(dfa)
        debug && printDfa('DFA without transitions from goal states', dfa)
    }

    dfa = minimizeDfa(dfa)
    debug && printDfa('Minimized DFA', dfa)
    let turing = toTuringMachine(dfa, expression)
    return [dfa, turing]
}

function writeComments(prefix, comments) {
    return comments.map((comment) => (comment.length > 0 ? `${prefix} ${comment}` : comment)).join('\n') + '\n'
}

function writeAsTuringMachineSimulator(turingMachine) {
    let output = writeComments('//', turingMachine.comments)
    output += '\n'
    output += `name: ${turingMachine.description}\n`
    output += `init: ${turingMachine.initialState}\n`
    output += `accept: ${turingMachine.acceptState}\n`
    output += '\n'

    for (let state of turingMachine.states) {
        output += writeComments('//', state.comments)
        for (let transition of state.transitions) {
            let read = transition.read == ' ' ? '_' : transition.read
            let write = transition.write == ' ' ? '_' : transition.write
            output += `${state.name},${read}\n`
            output += `${transition.next},${write},${transition.move}\n`
        }
    }
    return output
}

function writeAsTuringMachineIo(turingMachine) {
    let output = writeComments('#', turingMachine.comments)
    output += `# ${turingMachine.description}\n`
    output += `input: '<enter your input here>'\n`
    output += `blank: ' '\n`
    output += `start state: ${turingMachine.initialState}\n`
    output += `table:\n`

    for (let state of turingMachine.states) {
        output += writeComments('   #', state.comments)
        output += `  ${state.name}:\n`
        let optimized = new Map()
        for (let transition of state.transitions) {
            let read = transition.read
            let write = transition.write == read ? 'KEEP' : transition.write
            let next = transition.next == state.name ? 'SELF' : transition.next
            let move = transition.move == '<' ? 'L' : (transition.move == '>' ? 'R' : 'S')
            let key = `${write}--${move}--${next}`
            let value = optimized.get(key)
            if (value) {
                value.push(read)
            } else {
                optimized.set(key, [read])
            }
        }

        function quoteNonAlphanumeric(s) {
            if (s.match(/^[a-zA-Z0-9]+$/)) {
                return s
            } else {
                return `'${s}'`
            }
        }

        let transitions = [] // [first-symbol, reads, write, move, next]
        let longest_reads = 0
        for (let [key, value] of optimized) {
            let symbols = value.sort()
            let reads = symbols.map(v => `${quoteNonAlphanumeric(v)}`).join(',')
            reads = symbols.length == 1 ? reads : `[${reads}]`
            longest_reads = Math.max(longest_reads, reads.length)
            // optimized.set(key, [reads[0], reads])
            let [write, move, next] = key.split('--')
            transitions.push([symbols[0], reads, write, move, next])
        }
        transitions.sort((a, b) => a[0].localeCompare(b[0]))

        for (let [firstSymbol, reads, write, move, next] of transitions) {
            // Pad reads to align columns
            reads = reads.padEnd(longest_reads)
            // let [write, move, next] = key.split('--')
            if (write == 'KEEP' && next == 'SELF') {
                output += `    ${reads}: ${move}\n`
            } else {
                let entries = []
                if (write != 'KEEP') {
                    entries.push(`write: ${quoteNonAlphanumeric(write)}`)
                }
                if (next == 'SELF') {
                    entries.push(move)
                } else {
                    entries.push(`${move}: ${next}`)
                }
                output += `    ${reads}: {${entries.join(', ')}}\n`
            }
        }
    }
    output += `\n  ${turingMachine.acceptState}:\n`
    if (turingMachine.rejectState) {
        output += `\n  ${turingMachine.rejectState}:\n`
    }
    return output
}

function writeAsGraphvizDFA(dfa) {
    out = `digraph {\n`
    out += `  rankdir=LR;\n`
    if (dfa.length > 0) {
        out += `  start [shape=plaintext, label=""];\n`
        out += `  start -> ${dfa[0].id};\n`
    }
    for (let state of dfa) {
        let suffix = state.isGoal() ? ' [shape=doublecircle]' : ' [shape=circle]'
        out += `  ${state.id}${suffix};\n`

        // combine transitions with same next state
        let combined = new Map()
        for (let [symbol, next] of state.next.entries()) {
            let value = combined.get(next.id)
            if (value) {
                value.push(symbol)
            } else {
                combined.set(next.id, [symbol])
            }
        }
        function pushRange(reduced, start, end) {
            const [from, to] = [start.charCodeAt(0), end.charCodeAt(0)]
            if (to - from < 2) {
                for (let i = from; i <= to; i++) {
                    reduced.push(String.fromCharCode(i))
                }
            } else {
                reduced.push(`${start}-${end}`)
            }
        }
        // reduce 3 or more sequential symbols to a range
        for (let [next, symbols] of combined.entries()) {
            symbols.sort()
            let reduced = []
            let start = null
            let prev = null
            for (let symbol of symbols) {
                if (prev == null) {
                    start = symbol
                } else if (symbol.charCodeAt(0) != prev.charCodeAt(0) + 1) {
                    pushRange(reduced, start, prev)
                    start = symbol
                }
                prev = symbol
            }
            pushRange(reduced, start, prev)
            combined.set(next, reduced)
        }

        let keys = Array.from(combined.keys()).sort()
        for (let next of keys) {
            let symbols = combined.get(next)
            let label = symbols.map(v => `${v}`).join(',')
            out += `  ${state.id} -> ${next} [label="${label}"];\n`
        }
    }
    out += '}\n'
    return out
}

function writeToTarget(dfa, turing, target) {
    let out = null
    switch (target) {
        case 'turingmachinesimulator.com':
            out = writeAsTuringMachineSimulator(turing)
            break
        case 'turingmachine.io':
            out = writeAsTuringMachineIo(turing)
            break
        case 'dfa':
            out = writeAsGraphvizDFA(dfa)
            break
        default:
            throw `Unknown output format ${target}`
    }
    return out
}

function compile() {
    var errorElement = document.getElementById('error')
    errorElement.classList.remove('show')

    document.getElementById('output').value = ''

    let expression = document.getElementById('expression').value
    let alphabet = document.getElementById('alphabet').value
    let accept = document.getElementById('accept').value
    let reject = document.getElementById('reject').value
    const target = document.querySelector('input[name="target"]:checked').id;
    const mode = document.querySelector('input[name="mode"]:checked').id;
    const advanced = document.getElementById("advanced").classList.contains("show")

    // Update the query parameters with the values of the input fields
    var url = new URL(window.location.href)
    url.search = ''
    expression && url.searchParams.set("expression", expression)
    alphabet && url.searchParams.set("alphabet", alphabet)
    target && url.searchParams.set("target", target)
    mode && url.searchParams.set("mode", mode)
    accept && url.searchParams.set("accept", accept)
    reject && url.searchParams.set("reject", reject)
    advanced && url.searchParams.set("advanced", 'true')

    // Update the URL in the browser
    window.history.pushState({}, "", url.href)

    let result = null
    try {
        let expr = new Expression(expression, alphabet, accept, reject, mode)
        let [dfa, turingMachine] = compileExpression(expr)
        result = writeToTarget(dfa, turingMachine, target)
    } catch (err) {
        errorElement.innerHTML = err
        errorElement.classList.add('show')
        console.log(err)
        return
    }

    const targetLink = document.getElementById('target-link')
    switch (target) {
        case 'turingmachinesimulator.com':
            targetLink.href = 'https://turingmachinesimulator.com/'
            targetLink.innerHTML = 'Turing Machine Simulator'
            break
        case 'turingmachine.io':
            targetLink.href = 'https://turingmachine.io/'
            targetLink.innerHTML = 'Turing Machine Visualizer'
            break
        case 'dfa':
            const uriEncoded = encodeURIComponent(result)
            targetLink.href = `https://dreampuf.github.io/GraphvizOnline/#${uriEncoded}`
            targetLink.innerHTML = 'Graphviz Online'
            break
        default:
            throw `Unknown output format ${target}`
    }

    document.getElementById('output').value = result
}

function copyToClipboard() {
    let text = document.getElementById('output').value
    navigator.clipboard.writeText(text)
    let button = document.getElementById('copy-button')
    const tooltip = bootstrap.Tooltip.getInstance('#copy-button')
    button.setAttribute('data-bs-original-title', 'Copied!')
    tooltip.update()
    tooltip.show()
    setTimeout(function() {
        tooltip.hide()
        button.setAttribute('data-bs-original-title', 'Copy to clipboard')
        tooltip.update()
    }, 3000);
}

if (typeof module !== 'undefined') {
    module.exports = {
        Expression: Expression,
        compileExpression: compileExpression,
        setDebug: setDebug,
    }
}

function cliCompile(expr, alphabet, acceptState, rejectState, mode, target) {
    let expression = new Expression(expr, alphabet, acceptState, rejectState, mode)
    let [dfa, turing] = compileExpression(expression)
    const out = writeToTarget(dfa, turing, target)
    console.log(`Output:\n${out}`)
}

function usage() {
    console.log('Usage: node turingregex.js [options] <expression> [alphabet]')
    console.log('Options:')
    console.log('  -d: enable debug output')
    console.log('  -m <mode>: set mode (find, match, contains)')
    console.log('  -a <state>: set accept state')
    console.log('  -r <state>: set reject state')
    console.log('  -o <output>: set output (turingmachinesimulator.com (default), turingmachine.io, dfa')
    console.log('  -h: show this help')
}

function runFromCLI() {
    let expr = null
    let alphabet = null
    let mode = 'match'
    let acceptState = null
    let rejectState = null
    let output = 'turingmachinesimulator.com'

    // Parse options (starting with -)
    let idx = 2
    for (; idx < process.argv.length; idx++) {
        let arg = process.argv[idx]
        if (arg.startsWith('-')) {
            switch (arg) {
                case '-h':
                    usage()
                    process.exit(0)
                case '-d':
                    setDebug(true)
                    break
                case '-m':
                    mode = process.argv[++idx]
                    break
                case '-a':
                    acceptState = process.argv[++idx]
                    break
                case '-r':
                    rejectState = process.argv[++idx]
                    break
                case '-o':
                    output = process.argv[++idx]
                    break
                default:
                    console.log(`Unknown option ${arg}`)
                    process.exit(1)
            }
        } else {
            break
        }
    }

    if (idx >= process.argv.length) {
        console.log('Missing expression, use -h for help')
        process.exit(1)
    }

    expr = process.argv[idx++]
    if (idx < process.argv.length) {
        alphabet = process.argv[idx++]
    }
    cliCompile(expr, alphabet, acceptState, rejectState, mode, output)
}

function initPage() {
    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
    var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl, {'delay': { show: 1000, hide: 200 }})
    })

    // Get optional query parameters and initialize the form accordingly
    var url = new URL(window.location.href);

    var expression = url.searchParams.get("expression")
    var alphabet = url.searchParams.get("alphabet")
    var target = url.searchParams.get("target")
    var mode = url.searchParams.get("mode")
    var accept = url.searchParams.get("accept")
    var reject = url.searchParams.get("reject")
    var advanced = url.searchParams.get("advanced")

    if (expression) {
        document.getElementById("expression").value = expression
    }
    if (alphabet) {
        document.getElementById("alphabet").value = alphabet
    }
    if (target) {
        document.getElementById("turingmachinesimulator.com").checked = target === 'turingmachinesimulator.com'
        document.getElementById("turingmachine.io").checked = target === 'turingmachine.io'
        document.getElementById("dfa").checked = target === 'dfa'
    }
    if (mode) {
        document.getElementById("match").checked = mode === 'match'
        document.getElementById("contains").checked = mode === 'contains'
        document.getElementById("find").checked = mode === 'find'
    }
    if (accept) {
        document.getElementById("accept").value = accept
    }
    if (reject) {
        document.getElementById("accept").value = accept
    }
    if (advanced === "true") {
        document.getElementById("advanced").classList.add('show')
    }

    if (expression) {
        compile()
    }
}

if (typeof process == 'undefined') {
    console.log('turingregex running from browser')
    window.onload = initPage
    // $(function () {
    //     $('[data-bs-toggle="tooltip"]').tooltip({'delay': { show: 1000, hide: 200 }})
        // var dropdownMenu = document.getElementById('targetDropdown')
        // var dropdownButton = document.getElementById('targetDropdownButton')
        // dropdownMenu.addEventListener('click', function(event) {
        //     dropdownButton.innerHTML = event.target.innerHTML.trim()
        // })
    // })
} else {
    if (process.argv[1].endsWith('turingregex.js')) {
        console.log('turingregex running from console')
        runFromCLI()
    } else {
        console.log('turingregex loaded as library')
    }
}
