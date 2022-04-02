class Expression {
    constructor(expression, alphabet, accept, reject, find) {
        this.expression = expression
        this.alphabet = alphabet
        this.accept = accept
        this.reject = reject
        this.find = find
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
        let out = this.children.map(c => c.id)
        if (this.open) out.push('⊙')
        return `${this.id} (${c}→${out.join()})`
    }
    doSetOutput(next, visited) {
        if (visited.has(this.id)) return
        visited.add(this.id)
        this.children.forEach(c => c.doSetOutput(next, visited))
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
    constructor(nfaStates) {
        this.nfaStates = nfaStates
        this.next = new Map()
        this.id = -1
        this.key = nfaStates.map(s => s.id).sort().join()
        this.goal = nfaStates.filter(s => s.isGoal()).length > 0
    }
    addTransition(symbol, dfaState) {
        this.next.set(symbol, dfaState)
    }
    toString() {
        return `${this.id} - ${this.key} - ${this.nfaStates}`
    }
    isGoal() {
        return this.goal
    }
}

const TOKENSTATE_GLOBAL=0
const TOKENSTATE_CHARCLASS=1
class Parser {
    constructor(expression) {
        this.expr = expression.expression
        if (expression.find) this.expr = `.*${this.expr}`
        this.alphabet = expression.alphabet
        this.index = 0
        this.token = null
        this.tokenState=TOKENSTATE_GLOBAL
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
        if (this.token == null && this.index<this.expr.length) this.fetchNextToken()
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
                let size=0
                for (let c = start; c <= next; c=String.fromCharCode(c.charCodeAt(0) + 1)) {
                    characters.push(c)
                    size++
                    if (size>1000) {
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
            characters.forEach(c => alphabet.delete(c))
            characters = alphabet
        }
        return NFAState.lambda(Array.from(new Set(characters)).map(c => NFAState.terminal(c)), false)
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
            end = null // infiniy
        } else if (match[3]) {
            end = parseInt(match[3])
        }
        let expr = NFAState.lambda([], true)
        let lastElement = expr
        for (let i=0; i<start; i++) {
            let clone = p1.clone()
            expr.setOutput(clone)
            lastElement = clone
        }
        if (end) {
            let tail = NFAState.lambda([], true)
            for (let i=start; i<end; i++) {
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
        // this.tokenize()
        // debug && console.log(`Tokens: ${this.tokens}`)
        let result = this.parseExpression()
        if (!this.end) {
            this.fail('Unexpected trailing characters')
        }
        return result
    }
}

function nfaClosure(states) {
    let stateIds = new Set([])
    let todo = states.slice(0)
    let closure = []
    while (todo.length > 0) {
        let s = todo.pop()
        closure.push(s)
        for (let child of s.children.filter(c => !(c.char || stateIds.has(c.id)))) {
            stateIds.add(child.id)
            todo.push(child)
        }
    }
    return closure
}

function goTo(states, symbol) {
    return nfaClosure(states.flatMap(state => state.children.filter(child => child.char == symbol)))
}

// returns the Set of symbols accepted by the given list of states
function getSymbols(states) {
    let childSet = states.flatMap(state => state.children)
    return new Set(childSet.map(state => state.char).filter(symbol => symbol))
}

function nfa2dfaSub(dfaSet, dfa) {
    dfaSet.push(dfa)
    let symbols = getSymbols(dfa.nfaStates)

    for (let symbol of symbols) {
        let targets = goTo(dfa.nfaStates, symbol)
        let newState = new DFAState(targets)
        let existing = false
        for (let curState of dfaSet.filter(c => c.key == newState.key)) {
            newState = curState
            existing = true
        }
        dfa.addTransition(symbol, newState)
        if (!existing) {
            nfa2dfaSub(dfaSet, newState)
        }
    }
}

function nfa2dfa(nfa) {
    let stateSet = nfaClosure([NFAState.lambda([nfa], false)])
    let dfa = []
    nfa2dfaSub(dfa, new DFAState(stateSet))
    for (let i = 0; i < dfa.length; i++) {
        dfa[i].id = i
    }
    return dfa
}

function makeDfaKey(dfaState) {
    return Array.from(dfaState.next).map(entry => entry[0] + "." + entry[1].id).sort().join() + (dfaState.goal ? ':goal' : '')
}

function minimizeDfa(dfa) {
    let newDfa = dfa.slice(0)
    let states = new Map()
    let changed = true
    while (changed) {
        changed = false
        states.clear()
        for (let state of newDfa) {
            if (!state) continue
            let key = makeDfaKey(state)
            if (states.has(key)) {
                target = newDfa[states.get(key)]
                newDfa[state.id] = null
                for (let s of newDfa.filter(s => s)) {
                    for (let entry of s.next) {
                        if (entry[1] == state) {
                            s.next.set(entry[0], target)
                        }
                    }
                }
                changed = true
                break
            } else {
                states.set(key, state.id)
            }
        }
    }
    newDfa = newDfa.filter(s => s)

    // renumber states
    for (let i=0; i<newDfa.length; i++) {
        newDfa[i].id = i
    }

    return newDfa
}

function printNfa(nfa) {
    let set = new Set([nfa.id])
    let todo = [nfa]
    let result = new Map()
    while (todo.length > 0) {
        let state = todo.pop()
        result.set(state.id, state)
        state.children.forEach(child => {
            if (!set.has(child.id)) {
                set.add(child.id)
                todo.push(child)
            }
        })
    }
    console.log('NFA:')
    for (let entry of new Map([...result.entries()].sort())) {
        console.log(`  ${entry[1]}`)
    }
}

function printDfa(title, dfa) {
    console.log(`${title}: (${dfa.length} states)`)
    for (let state of dfa) {
        let suffix = state.isGoal() ? ' ⊙ ' : '   '
        console.log(`  ${state.id}${suffix}`)
        for (let entry of state.next.entries()) {
            console.log(`    ${entry[0]} -> ${entry[1].id}`)
        }
    }
}

function compileExpression(expression) {
    if (expression.find && !expression.alphabet) {
        throw `An explicit alphabet is required by the find option`
    }
    let parser = new Parser(expression)
    let nfa = parser.parse()
    debug && printNfa(nfa)
    let dfa = nfa2dfa(nfa)
    debug && printDfa("DFA", dfa)
    dfa = minimizeDfa(dfa)
    debug && printDfa("Minimized DFA", dfa)
    return dfa
}

function toTuringMachine(dfa, expression) {
    let prefix = 'regex'
    let acceptState = expression.accept || `${prefix}_accept`
    let rejectState = expression.reject
    let alphabet = expression.alphabet ? new Set(expression.alphabet.split('')) : null
    if (rejectState && !alphabet) {
        throw 'An explicit alphabet is required when a reject state is given'
    }

    let output = '// generated by regex2turing:\n'
    output += '// https://bertbaron.github.io/regex2turing/\n\n'
    output += `name: Accepts inputs ${expression.find ? 'containing' : 'matching'} regex '${expression.expression}'\n`
    output += `init: ${prefix}0\n`
    output += `accept: ${acceptState}\n\n`
    for (let state of dfa) {
        let findGoal = expression.find && state.isGoal()
        let symbols = new Set([])
        if (!findGoal) {
            for (let entry of state.next.entries()) {
                let symbol = entry[0]
                output += `${prefix}${state.id},${symbol}\n`
                output += `${prefix}${entry[1].id},${symbol},>\n`
                symbols.add(symbol)
            }
            if (rejectState) {
                for (let symbol of alphabet) {
                    if (!symbols.has(symbol)) {
                        output += `${prefix}${state.id},${symbol}\n`
                        output += `${rejectState},${symbol},-\n`
                    }
                }
            }
        }

        if (state.isGoal()) {
            let a = expression.find ? expression.alphabet : '_'
            a = a.includes('_') ? a : a + '_'
            for (let i=0; i<a.length; i++) {
                output += `${prefix}${state.id},${a.charAt(i)}\n`
                output += `${acceptState},${a.charAt(i)},-\n`    
            }
        }
        output += '\n'
    }
    return output
}
function compile() {
    var errorElement = document.getElementById("error");
    errorElement.classList.remove("show");

    document.getElementById('output').value = ''

    let expression = document.getElementById('expression').value
    let alphabet = document.getElementById('alphabet').value
    let accept = document.getElementById('accept').value
    let reject = document.getElementById('reject').value
    let find = document.getElementById('find').checked
    let result = null
    try {
        let expr = new Expression(expression, alphabet, accept, reject, find)
        let dfa = compileExpression(expr)
        result = toTuringMachine(dfa, expr)
    } catch (err) {
        errorElement.innerHTML = err
        errorElement.classList.add("show");
        return
    }
    document.getElementById('output').value = result
}

function copyToClipboard() {
    let text = document.getElementById('output').value
    navigator.clipboard.writeText(text)
}

if (typeof (module) !== 'undefined') {
    module.exports = {
        compileExpression: compileExpression,
        setDebug: setDebug
    };
}

function cliCompile(expr, alphabet) {
    setDebug(true)
    let expression = new Expression(expr, alphabet, null, null, false)
    let dfa = compileExpression(expression)
    let turing = toTuringMachine(dfa, expression)
    console.log(`Turing machine:\n${turing}`)
}

function runFromCLI() {
    // called directly with node.js
    if (process.argv.length <= 2) {
        console.log("Usage: node turingregex.js <expression> [alphabet]")
        process.exit(1)
    }
    let expr = null
    let alphabet = null
    if (process.argv.length > 2) {
        expr = process.argv[2]
    }
    if (process.argv.length > 3) {
        alphabet = process.argv[3]
    }
    cliCompile(expr, alphabet)
}

if (typeof (process) == 'undefined') {
    console.log('turingregex running from browser')
    $(function () {
        $('[data-toggle="tooltip"]').tooltip()
    })
} else {
    if (process.argv[1].endsWith('turingregex.js')) {
        console.log('turingregex running from console')
        runFromCLI()
    } else {
        console.log('turingregex loaded as library')
    }
}
