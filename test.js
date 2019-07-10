var turingregex = require('./turingregex.js');

correctCases = [
    [null, 'a', 'a', 'b', '', 'aa', 'bb', 'ab'],
    [null, 'ab|ac', 'a', 'b', 'ab', 'ac', 'ba', 'ca', 'abc'],
    [null, 'abc|def', 'abc', 'def', 'ab', 'de', 'abf,abcd'],
    [null, 'a|b|c', 'a', 'b', 'c', '', 'ab', 'cc'],
    [null, 'a|bc|d', 'a', 'ad', 'bc', 'bd', 'abcd'],
    [null, '(a|b)(c|d)', 'a', 'ad', 'bc', 'bd', 'abcd'],
    [null, 'aa*b', 'a', 'ab', 'aab', 'aaab', 'b'],
    [null, 'aa+b', 'a', 'ab', 'aab', 'aaab', 'b'],
    [null, 'aa?b', 'a', 'ab', 'aab', 'aaab', 'b'],
    [null, '[abc]+', 'a', 'aa', 'ab', 'abc', 'd'],
    ['abc', '[^ab]+b', 'a', 'b', 'c', 'ab', 'bb', 'cb', 'ccb'],
    [null, '\\*|\\\\', '*', '\\', '\\*', '\\\\*'],
    ['abc', 'a.*b', 'a', 'b', 'ab', 'aab', 'ac', 'acb', 'accb'],
    [null, 'ab{3}c', 'abc', 'abbc','abbbc','abbbbc','abbbbbc'],
    [null, 'ab{2,}c', 'abc', 'abbc','abbbc','abbbbc','abbbbbc'],
    [null, 'ab{2,4}c', 'abc', 'abbc','abbbc','abbbbc','abbbbbc'],
]

count = 0
failcount = 0

function fail(message) {
    console.log(`FAIL ${message}`)
    failcount++
}

function matchDfa(dfa, text) {
    let state = dfa[0]
    for (let i = 0; i < text.length; i++) {
        let c = text.charAt(i)
        state = state.next.get(c)
        if (!state) {
            return false
        }
    }
    return state.isGoal()
}

function runCorrectCase(alphabet, pattern, examples) {
    let re = new RegExp(`^(${pattern})$`)
    let dfa = turingregex.compileExpression({ expression: pattern, alphabet: alphabet })
    for (let example of examples) {
        expected = re.test(example)
        actual = matchDfa(dfa, example)
        count++
        if (expected != actual) {
            fail(`Failed match for ${pattern} on ${example}, expected ${expected} but was ${actual}`)
        }
    }
}

function runCorrectCases() {
    for (let testcase of correctCases) {
        runCorrectCase(testcase[0], testcase[1], testcase.slice(2))
    }
}

function runTests() {
    runCorrectCases()
}

turingregex.setDebug(false)
runTests()

if (failcount > 0) {
    console.log(`There were ${failcount} failing tests!`)
    process.exit(1)
}

console.log(`Succesfully ran ${count} tests`)
