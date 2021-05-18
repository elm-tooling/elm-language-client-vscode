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
import { expect } from "chai";
import { TestCompleted } from "../result";
import { insertRunTestData, RunTestSuite } from "../runTestSuite";

describe("run test suite", () => {
  const empty: RunTestSuite = {
    type: "suite",
    id: "top",
    label: "top",
    children: [],
  };

  it("empty", () => {
    const data: TestCompleted = {
      tag: "testCompleted",
      labels: ["Module", "test"],
      messages: [],
      duration: 0,
      status: { tag: "pass" },
    };
    const top = insertRunTestData(empty, data);
    expect(top).to.eql({
      type: "suite",
      id: "top",
      label: "top",
      children: [
        {
          type: "suite",
          id: "top/Module",
          label: "Module",
          children: [
            {
              type: "test",
              id: "top/Module/test",
              label: "test",
              data,
            },
          ],
        },
      ],
    });
  });

  it("add to suite", () => {
    const data: TestCompleted = {
      tag: "testCompleted",
      labels: ["Module", "test"],
      messages: [],
      duration: 0,
      status: { tag: "pass" },
    };

    const top: RunTestSuite = {
      type: "suite",
      id: "top",
      label: "top",
      children: [
        {
          type: "suite",
          id: "top/Module",
          label: "Module",
          children: [
            {
              type: "test",
              id: "top/Module/test",
              label: "test",
              data,
            },
          ],
        },
      ],
    };

    const data2: TestCompleted = {
      tag: "testCompleted",
      labels: ["Module", "test2"],
      messages: [],
      duration: 0,
      status: { tag: "pass" },
    };

    const top1 = insertRunTestData(top, data2);
    expect(top1).to.eql({
      type: "suite",
      id: "top",
      label: "top",
      children: [
        {
          type: "suite",
          id: "top/Module",
          label: "Module",
          children: [
            {
              type: "test",
              id: "top/Module/test",
              label: "test",
              data,
            },
            {
              type: "test",
              id: "top/Module/test2",
              label: "test2",
              data: data2,
            },
          ],
        },
      ],
    });
  });

  it("duplicate", () => {
    const data: TestCompleted = {
      tag: "testCompleted",
      labels: ["Module", "test"],
      messages: [],
      duration: 0,
      status: { tag: "pass" },
    };

    const top: RunTestSuite = {
      type: "suite",
      id: "top",
      label: "top",
      children: [
        {
          type: "suite",
          id: "top/Module",
          label: "Module",
          children: [
            {
              type: "test",
              id: "top/Module/test",
              label: "test",
              data,
            },
          ],
        },
      ],
    };
    expect(() => insertRunTestData(top, data)).to.throw(
      "duplicate id 'top/Module/test'",
    );
  });
});
