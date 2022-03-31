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
        this.key = makeKey(nfaStates)
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

class Parser {
    constructor(expression) {
        this.expr = expression.expression
        if (expression.find) this.expr = `.*${this.expr}`
        this.alphabet = expression.alphabet
        this.tokens = []
        this.indices = []
        this.index = 0
    }

    tokenize() {
        let self = this
        let pushtoken = function (token, index) {
            self.tokens.push(token)
            self.indices.push(index)
        }
        for (let i = 0; i < this.expr.length; i++) {
            this.index = i // for error message
            let c = this.expr.charAt(i)
            if (c == '\\') {
                c = this.expr.charAt(++i)
                if (i == this.expr.length) {
                    fail('Expected escaped character but end of input found')
                }
                pushtoken(c, i)
                continue
            }
            switch (c) {
                case '|':
                case '(':
                case ')':
                case '*':
                case '+':
                case '?':
                case '[':
                case ']':
                case '.':
                case '^':
                case '{':
                case '}':
                    pushtoken('.' + c, i)
                    break
                default:
                    pushtoken(c, i)
                    break;
            }
        }
        this.index = 0
    }
    clean(t) {
        return t.length > 1 ? t.substring(1) : t
    }
    fail(message) {
        let idx = Math.min(this.index, this.tokens.length - 1)
        let index = this.indices.length > 0 ? this.indices[idx] : 0
        throw `Parsing error at index ${index}: ${message}`
    }
    end() {
        return this.index == this.tokens.length
    }
    checkEndOfInput(expected) {
        if (this.end()) this.fail(`Unexpected end of input, expected ${expected}`)
    }
    peek() {
        return this.tokens[this.index]
    }
    pop() {
        this.checkEndOfInput('more input')
        return this.tokens[this.index++]
    }
    popExpect(expecteds) {
        let exp = expecteds.length == 1 ? this.clean(expecteds[0]) : 'one of ' + expecteds.map(this.clean).join(', ')
        this.checkEndOfInput(`${exp}`)
        let token = this.peek()
        if (!expecteds.includes(token)) {
            this.fail(`Unexpected token: ${this.clean(token)}, expected ${exp}`)
        }
        return this.tokens[this.index++]
    }

    getAlphabet(reason) {
        if (!this.alphabet) {
            this.fail(`An explicit alphabet is required for ${reason}`)
        }
        return this.alphabet.split('')
    }

    parseCharacterClass() {
        // let expr = null
        let next = this.pop()
        let characters = new Set([])
        let complement = false
        if (next == '.^') {
            complement = true
            next = this.pop()
        }
        while (next != '.]') {
            if (next.length > 1) {
                this.fail(`Operator not allowed in character class: ${this.clean(next)}`)
            }
            characters.add(next)
            next = this.pop()
        }
        if (characters.length == 0) {
            this.fail(`Empty character class is not allowed`)
        }
        if (complement) {
            let alphabet = new Set(this.getAlphabet('^ character class'))
            characters.forEach(c => alphabet.delete(c))
            characters = alphabet
        }
        return NFAState.lambda(Array.from(characters).map(c => NFAState.terminal(c)), false)
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
        this.tokenize()
        debug && console.log(`Tokens: ${this.tokens}`)
        let result = this.parseExpression()
        if (!this.end) {
            this.fail('Unexpected trailing characters')
        }
        return result
    }
}

function nfaClosure(states) {
    let stateids = new Set([])
    let todo = states.slice(0)
    let closure = []
    while (todo.length > 0) {
        let s = todo.pop()
        closure.push(s)
        for (let child of s.children.filter(c => !(c.char || stateids.has(c.id)))) {
            stateids.add(child.id)
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
    let childset = states.flatMap(state => state.children)
    return new Set(childset.map(state => state.char).filter(symbol => symbol))
}

function makeKey(states) {
    return states.map(s => s.id).sort().join()
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
    let stateset = nfaClosure([NFAState.lambda([nfa], false)])
    let dfa = []
    nfa2dfaSub(dfa, new DFAState(stateset))
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
        console.log('turingregex running from console');
        runFromCLI()
    } else {
        console.log('turingregex loaded as library');
    }
}
