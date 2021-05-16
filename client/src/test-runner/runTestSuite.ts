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

import { TestCompleted } from "./result";

export type RunTestItem = RunTestSuite | RunTestData;

export type RunTestSuite = {
  type: "suite";
  id: string;
  label: string;
  children: RunTestItem[];
};

export type RunTestData = {
  type: "test";
  id: string;
  label: string;
  data: TestCompleted;
};

export function insertRunTestData(
  suite: RunTestSuite,
  data: TestCompleted,
): RunTestSuite {
  return doInsertRunTestData(suite, [...data.labels], data);
}

function doInsertRunTestData(
  suite: RunTestSuite,
  labels: string[],
  data: TestCompleted,
): RunTestSuite {
  if (labels.length === 1) {
    const label = labels[0];
    const testData: RunTestData = {
      type: "test",
      id: `${suite.id}/${label}`,
      label,
      data,
    };
    const exists = suite.children.some((child) => child.label === label);
    if (!exists) {
      return {
        ...suite,
        children: [...suite.children, testData],
      };
    } else {
      throw new Error(`duplicate id '${testData.id}'`);
    }
  }
  const labels1 = [...labels];
  const label = labels1.shift();
  if (label === undefined) {
    throw new Error("???");
  }

  const exists = suite.children.some((child) => child.label === label);
  if (!exists) {
    const newSuite: RunTestSuite = {
      type: "suite",
      id: `${suite.id}/${label}`,
      label,
      children: [],
    };
    return {
      ...suite,
      children: [
        ...suite.children,
        doInsertRunTestData(newSuite, labels1, data),
      ],
    };
  } else {
    const children = suite.children.map((child) =>
      child.type === "suite" && child.label === label
        ? doInsertRunTestData(child, labels1, data)
        : child,
    );
    return { ...suite, children };
  }
}
