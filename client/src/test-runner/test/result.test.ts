/*
MIT License

 Copyright 2021 Frank Wagner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { expect } from 'chai'

import {
    parseOutput,
    Result,
    buildMessage,
    parseErrorOutput,
    Output,
    EventTestCompleted,
    parseResult,
} from '../result'

describe('Result', () => {
    describe('parse results', () => {
        it('one line pass', () => {
            const line =
                '{"event":"testCompleted","status":"pass","labels":["suite","nested","test"],"failures":[],"duration":"13"}'
            const output = parseOutput(line)
            expectResult(output, (result) => {
                expectEvent(result, (event) => {
                    expect(event.status.tag).to.eql('pass')
                    expect(event.labels).to.eql(['suite', 'nested', 'test'])
                    expect(event.duration).to.eql(13)
                })
            })
        })

        it('one line todo', () => {
            const line =
                '{"event":"testCompleted","status":"todo","labels":["suite"],"failures":["todo comment"],"duration":"1"}'
            const output = parseOutput(line)
            expectResult(output, (result) => {
                expectEvent(result, (event) => {
                    expect(event.labels).to.eql(['suite'])
                    expect(event.duration).to.eql(1)
                    expect(event.status.tag).to.eql('todo')
                    if (event.status.tag === 'todo') {
                        expect(event.status.comment).to.eql('todo comment')
                    }
                })
            })
        })

        it('a message', () => {
            const line = 'a message'
            const output = parseOutput(line)
            expect(output?.type).to.eq('message')
            if (output?.type === 'message') {
                expect(output.line).to.eql(line)
            }
        })

        it('boken json', () => {
            const line = '{ boken'
            const output = parseOutput(line)
            expect(output?.type).to.eq('message')
            if (output?.type === 'message') {
                expect(output.line).to.eql(line)
            }
        })

        it('compile errors', () => {
            const line = `
            {
                "type": "compile-errors",
                "errors": [{
                    "path": "path/to/file.elm",
                    "name": "a name",
                    "problems": [{
                        "title": "THE ERROR",
                        "region": {
                            "start": {
                                "line": 17,
                                "column": 5
                            },
                            "end": {
                                "line": 17,
                                "column": 10
                            }
                        },
                        "message": [
                            "some text",
                            { "string": "more text" }
                        ]
                    }]
                }]
            }
            `
            const output = parseErrorOutput(line)
            const expected = {
                type: 'compile-errors',
                errors: [
                    {
                        path: 'path/to/file.elm',
                        name: 'a name',
                        problems: [
                            {
                                title: 'THE ERROR',
                                region: {
                                    start: { line: 17, column: 5 },
                                    end: { line: 17, column: 10 },
                                },
                                message: ['some text', { string: 'more text' }],
                            },
                        ],
                    },
                ],
            }
            expect(output).to.eql(expected)
        })
    })

    describe('build message', () => {
        it('empty', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw: any = {
                event: 'tralala',
                status: 'pass',
                labels: ['suite', 'test'],
                failures: [],
                messages: [],
                duration: '0',
            }
            expect(() => parseResult(raw)).to.throw('unknown event tralala')
        })
        it('with messages', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw: any = {
                event: 'testCompleted',
                status: 'pass',
                labels: ['suite', 'test'],
                failures: [],
                messages: ['hello', 'world'],
                duration: '13',
            }
            const event: EventTestCompleted = {
                tag: 'testCompleted',
                labels: ['suite', 'test'],
                messages: ['hello', 'world'],
                status: { tag: 'pass' },
                duration: 13,
            }
            const result: Result = {
                type: 'result',
                event,
            }
            expect(parseResult(raw)).to.eql(result)
            const message = buildMessage(event)
            expect(message).to.eq('hello\nworld')
        })

        it('with failure with string reason', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw: any = {
                event: 'testCompleted',
                status: 'fail',
                labels: ['suite', 'test'],
                failures: [
                    {
                        message: 'boom',
                        reason: {
                            data: 'broken',
                        },
                    },
                ],
                messages: [],
                duration: '0',
            }
            const event: EventTestCompleted = {
                tag: 'testCompleted',
                labels: ['suite', 'test'],
                messages: [],
                duration: 0,
                status: {
                    tag: 'fail',
                    failures: [
                        {
                            tag: 'message',
                            message: 'broken',
                        },
                    ],
                },
            }
            const result: Result = {
                type: 'result',
                event,
            }
            expect(parseResult(raw)).to.eql(result)
            const message = buildMessage(event)
            expect(message).to.eq('broken')
        })

        it('with failure without raeson data', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw: any = {
                type: 'result',
                event: 'testCompleted',
                status: 'fail',
                labels: ['suite', 'test'],
                failures: [
                    {
                        message: 'boom',
                        reason: {
                            data: undefined,
                        },
                    },
                ],
                messages: [],
                duration: '0',
            }
            const event: EventTestCompleted = {
                tag: 'testCompleted',
                labels: ['suite', 'test'],
                messages: [],
                duration: 0,
                status: {
                    tag: 'fail',
                    failures: [
                        {
                            tag: 'message',
                            message: 'boom',
                        },
                    ],
                },
            }
            const result: Result = {
                type: 'result',
                event,
            }
            expect(parseResult(raw)).to.eql(result)
            const message = buildMessage(event)
            expect(message).to.eq('boom')
        })

        it('with failure with comparison data', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw: any = {
                event: 'testCompleted',
                status: 'fail',
                labels: ['suite', 'test'],
                failures: [
                    {
                        message: 'boom',
                        reason: {
                            data: {
                                comparison: 'compare',
                                actual: 'actual',
                                expected: 'expected',
                            },
                        },
                    },
                ],
                messages: [],
                duration: '0',
            }
            const event: EventTestCompleted = {
                tag: 'testCompleted',
                labels: ['suite', 'test'],
                messages: [],
                duration: 0,
                status: {
                    tag: 'fail',
                    failures: [
                        {
                            tag: 'comparison',
                            comparison: 'compare',
                            actual: 'actual',
                            expected: 'expected',
                        },
                    ],
                },
            }
            const result: Result = {
                type: 'result',
                event,
            }
            expect(parseResult(raw)).to.eql(result)
            const message = buildMessage(event)
            expect(message).to.eq(
                ['actual', '| compare', 'expected'].join('\n')
            )
        })

        it('with failure with string literal in comparison data', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw: any = {
                event: 'testCompleted',
                status: 'fail',
                labels: ['suite', 'test'],
                failures: [
                    {
                        message: 'boom',
                        reason: {
                            data: {
                                comparison: 'compare',
                                actual: '"multi\\nline\\nactual"',
                                expected: '"quoted \\"expected\\""',
                            },
                        },
                    },
                ],
                messages: [],
                duration: '0',
            }
            const event: EventTestCompleted = {
                tag: 'testCompleted',
                labels: ['suite', 'test'],
                messages: [],
                duration: 0,
                status: {
                    tag: 'fail',
                    failures: [
                        {
                            tag: 'comparison',
                            comparison: 'compare',
                            actual: 'multi\nline\nactual',
                            expected: 'quoted "expected"',
                        },
                    ],
                },
            }
            const result: Result = {
                type: 'result',
                event,
            }
            expect(parseResult(raw)).to.eql(result)
            const message = buildMessage(event)
            expect(message).to.eq(
                [
                    'multi',
                    'line',
                    'actual',
                    '| compare',
                    'quoted "expected"',
                ].join('\n')
            )
        })

        it('with failure with other data', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw: any = {
                event: 'testCompleted',
                status: 'fail',
                labels: ['suite', 'test'],
                failures: [
                    {
                        message: 'boom',
                        reason: {
                            data: {
                                key1: 'value1',
                                key2: 'value2',
                            },
                        },
                    },
                ],
                messages: [],
                duration: '0',
            }
            const event: EventTestCompleted = {
                tag: 'testCompleted',
                labels: ['suite', 'test'],
                messages: [],
                duration: 0,
                status: {
                    tag: 'fail',
                    failures: [
                        {
                            tag: 'data',
                            data: {
                                key1: 'value1',
                                key2: 'value2',
                            },
                        },
                    ],
                },
            }
            const result: Result = {
                type: 'result',
                event,
            }
            expect(parseResult(raw)).to.eql(result)
            const message = buildMessage(event)
            expect(message).to.eq(['key1: value1', 'key2: value2'].join('\n'))
        })
    })

    it('with message and failure with comparison data', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw: any = {
            event: 'testCompleted',
            status: 'fail',
            labels: ['suite', 'test'],
            failures: [
                {
                    message: 'boom',
                    reason: {
                        data: {
                            comparison: 'compare',
                            actual: 'actual',
                            expected: 'expected',
                        },
                    },
                },
            ],
            messages: ['broken'],
            duration: '0',
        }
        const event: EventTestCompleted = {
            tag: 'testCompleted',
            labels: ['suite', 'test'],
            messages: ['broken'],
            duration: 0,
            status: {
                tag: 'fail',
                failures: [
                    {
                        tag: 'comparison',
                        comparison: 'compare',
                        actual: 'actual',
                        expected: 'expected',
                    },
                ],
            },
        }
        const result: Result = {
            type: 'result',
            event,
        }
        expect(parseResult(raw)).to.eql(result)
        const message = buildMessage(event)
        expect(message).to.eq(
            ['broken', 'actual', '| compare', 'expected'].join('\n')
        )
    })
})

function expectResult(output: Output, fun: (result: Result) => void) {
    expect(output.type).to.eq('result')
    if (output?.type === 'result') {
        fun(output)
    }
}

function expectEvent(result: Result, fun: (event: EventTestCompleted) => void) {
    expect(result.event.tag).to.eq('testCompleted')
    if (result?.event.tag === 'testCompleted') {
        fun(result.event)
    }
}
