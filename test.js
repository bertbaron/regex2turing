var turingregex = require('./turingregex.js')

class TuringResult {
    constructor(accepted, state, steps, tape, head) {
        this.accepted = accepted
        this.state = state
        this.steps = steps
        this.tape = tape
        this.head = head
    }

    toString() {
        return `TuringResult(accepted=${this.accepted}, state=${this.state}, steps=${this.steps}, tape=${this.tape}, head=${this.head})`
    }
}

/** Simple emulator to test the generated machines. Not optimized in any way. */
class TuringEmulator {
    constructor(program) {
        this.program = program
        this.ops = 0
    }

    findState(stateName) {
        for (let s of this.program.states) {
            if (s.name == stateName) {
                return s
            }
        }
        return null
    }

    findTransition(state, symbol) {
        for (let t of state.transitions) {
            if (t.read == symbol) {
                return t
            }
        }
        return null
    }

    tapeToText(tape) {
        return tape.join('').trim()
    }

    run(input, maxOps) {
        let tape = input.split('')
        let head = 0
        let stateName = this.program.initialState
        while (true) {
            if (stateName == this.program.acceptState) {
                return new TuringResult(true, stateName, this.ops, this.tapeToText(tape), head)
            }
            if (this.ops++ > maxOps) {
                throw new Error('Too many operations')
            }
            let state = this.findState(stateName)
            if (!state) {
                return new TuringResult(false, stateName, this.ops, this.tapeToText(tape), head)
            }
            let symbol = tape[head]
            let transition = this.findTransition(state, symbol)
            if (!transition) {
                return new TuringResult(false, stateName, this.ops, this.tapeToText(tape), head)
            }

            tape[head] = transition.write
            if (transition.move == '<') {
                head--
            } else if (transition.move == '>') {
                head++
            }

            if (head < 0) {
                tape.unshift(' ')
                head = 0
            } else if (head >= tape.length) {
                tape.push(' ')
            }

            stateName = transition.next
        }
    }
}

function assertResult(result, pattern, input, expectedAccepted, expectedTape) {
    if (result.accepted != expectedAccepted) {
        let expectedMatch = expectedAccepted ? 'accept' : 'reject'
        fail(`Expected '${pattern}' to ${expectedMatch} ${input} but was not (${result})`)
        return
    }
    if (!expectedAccepted && result.state != 'regex_reject') {
        fail(`Expected state 'regex_reject' but was ${result.state} (${result})`)
        return
    }
    if (result.tape != expectedTape) {
        fail(`Expected ${expectedTape} but was ${result.tape} (${result})`)
        return
    }
}

// [ alphabet, regex, examples...]
matchCases = [
    [null, 'a', 2, 'a', 'b', '', 'aa', 'bb', 'ab'],
    [null, 'ab|ac', 3, 'a', 'b', 'ab', 'ac', 'ba', 'ca', 'abc'],
    [null, 'abc|def', 6, 'abc', 'def', 'ab', 'de', 'abf,abcd'],
    [null, 'a|b|c', 2, 'a', 'b', 'c', '', 'ab', 'cc'],
    [null, 'a|bc|d', 3, 'a', 'ad', 'bc', 'bd', 'abcd'],
    [null, '(a|b)(c|d)', 3, 'a', 'ad', 'bc', 'bd', 'abcd'],
    [null, 'aa*b', 3, 'a', 'ab', 'aab', 'aaab', 'b'],
    [null, 'aa+b', 4, 'a', 'ab', 'aab', 'aaab', 'b'],
    [null, 'aa?b', 4, 'a', 'ab', 'aab', 'aaab', 'b'],
    [null, '[abc]+', 2, 'a', 'aa', 'ab', 'abc', 'd'],
    ['abc', '[^ab]+b', 3, 'a', 'b', 'c', 'ab', 'bb', 'cb', 'ccb'],
    ['a^', '\\^', 2, 'a', '^'],
    ['a^', '[\\^]', 2, 'a', '^'],
    ['ab^', '[a^]', 2, 'a', 'b', '^'],
    ['ab^', '[^\\^a]+\\^', 3, 'a', 'b', '^', 'ab', 'bb', 'b^', 'bb^'],
    [null, '[a-c]', 2, 'a', 'b', 'c', 'd'],
    [null, '[a\\-c]', 2, 'a', 'b', 'c', 'd', '-'],
    [null, '\\*|\\\\', 2, '*', '\\', '\\*', '\\\\*'],
    ['abc', 'a.*b', 3, 'a', 'b', 'ab', 'aab', 'ac', 'acb', 'accb'],
    [null, 'ab{3}c', 6, 'abc', 'abbc', 'abbbc', 'abbbbc', 'abbbbbc'],
    [null, 'ab{2,}c', 5, 'abc', 'abbc', 'abbbc', 'abbbbc', 'abbbbbc'],
    [null, 'ab{2,4}c', 7, 'abc', 'abbc', 'abbbc', 'abbbbc', 'abbbbbc'],
    [null, 'ab{0,2}c', 5, 'ac', 'abc', 'abbc', 'abbbc', 'abbbbc', 'abbbbbc'],
    [null, '[a-c]{2,}|(a+b)+', 3, 'a', 'b', 'ab', 'aabaab'],
]

count = 0
failcount = 0

function fail(message) {
    console.log(`FAIL ${message}`)
    failcount++
}

function runCase(alphabet, pattern, expectedSize, examples) {
    console.log(`Running match ${pattern} on ${examples}`)
    let re = new RegExp(`^(${pattern})$`)
    let [dfa, turingMachine] = turingregex.compileExpression({
        expression: pattern,
        alphabet: alphabet,
        mode: 'match'
    })
    if (dfa.length != expectedSize) {
        fail(`Expected ${expectedSize} states but was ${dfa.length} for ${pattern}`)
    }
    for (let example of examples) {
        let expected = re.test(example)
        let result = new TuringEmulator(turingMachine).run(example, 1000)
        let actual = result.accepted
        count++
        if (expected != actual) {
            fail(`Failed match for ${pattern} on ${example}, expected ${expected} but was ${actual}`)
        }
    }
}

function runMatchCases() {
    for (let testcase of matchCases) {
        runCase(testcase[0], testcase[1], testcase[2], testcase.slice(3))
    }
}

// [ alphabet, regex, examples...]
findAndContainsCases = [
    ['abc', '(a+b)+', 'cc', 'aab', 'aba', 'aabaab', 'aabaabaaaaaa', 'cacabaaabaacaab'],
    ['abc', 'ca|(a+b)+', 'abaaaaaaaaaaa'],
    ['abc', '(a|b)*abb', 'aabacaaaabbbbbabbcaabb'],
    ['abc', 'a|b', 'cb'],
]

function runFindCase(alphabet, pattern, examples) {
    let expr = new turingregex.Expression(pattern, alphabet, null, 'regex_reject', 'find')
    let [dfa, turingMachine] = turingregex.compileExpression(expr)
    for (let example of examples) {
        count++
        console.log(`Running find ${pattern} on ${example}...`)
        let expected = example.match(new RegExp(pattern))
        var result = new TuringEmulator(turingMachine).run(example, 1000)
        assertResult(result, pattern, example, expected != null, expected ? expected[0] : '')
    }
}

function runFindCases() {
    for (let testcase of findAndContainsCases) {
        runFindCase(testcase[0], testcase[1], testcase.slice(2))
    }
}

function runContainsCase(alphabet, pattern, examples) {
    let expr = new turingregex.Expression(pattern, alphabet, null, 'regex_reject', 'contains')
    let [dfa, turingMachine] = turingregex.compileExpression(expr)
    for (let example of examples) {
        count++
        console.log(`Running contains ${pattern} on ${example}...`)
        let expected = example.match(new RegExp(pattern))
        var result = new TuringEmulator(turingMachine).run(example, 1000)
        assertResult(result, pattern, example, expected != null, example)
    }
}

function runContainsCases() {
    for (let testcase of findAndContainsCases) {
        runContainsCase(testcase[0], testcase[1], testcase.slice(2))
    }
}

findExpectedStepCounts = [
    ['abc', '(a+b)+', 'abaaaaaaaaaaa', 12, 31],
    ['abc', '(a+b)+', 'ccaaaaaaaacab', 12, 108],
    ['abc', 'ca|(a+b)+', 'abaaaaaaaaaaa', 16, 201],
]

function testNumberOfStepsCase(alphabet, pattern, example, expectedStateCount, expectedSteps) {
    let expr = new turingregex.Expression(pattern, alphabet, null, null, 'find')
    let [dfa, turingMachine] = turingregex.compileExpression(expr)
    if (turingMachine.states.length != expectedStateCount) {
        fail(`Expected ${expectedStateCount} states but got ${turingMachine.states.length}`)
    }

    var result = new TuringEmulator(turingMachine).run(example, 1000)
    assertResult(result, pattern, example, true, 'ab')
    console.log(`Running find ${pattern} on ${example} should take ${expectedSteps} steps...`)
    if (result.steps != expectedSteps) {
        fail(`Expected ${expectedSteps} steps but got ${result.steps}`)
    }
}

function testNumberOfSteps() {
    for (let testcase of findExpectedStepCounts) {
        count++
        testNumberOfStepsCase(testcase[0], testcase[1], testcase[2], testcase[3], testcase[4])
    }
}

function runTests() {
    runMatchCases()
    runFindCases()
    runContainsCases()
    testNumberOfSteps()
}

turingregex.setDebug(false)
runTests()

if (failcount > 0) {
    console.log(`There were ${failcount} failing tests!`)
    process.exit(1)
}

console.log(`Succesfully ran ${count} tests`)
