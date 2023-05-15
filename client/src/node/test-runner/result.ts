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
import * as json from "jsonc-parser";

export interface ITestResult {
  event: string;
  testCount: string;
  passed: string;
  failed: string;
  duration: string;
  messages: string[];
  labels: string[];
  status: string;
  failures: {
    message: string;
    reason: {
      data: {
        comparison: string;
        actual: string;
        expected: string;
      };
    };
  }[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

export function parseOutput(line: string): Output {
  const errors: json.ParseError[] = [];
  const parsed: ITestResult = json.parse(line, errors);
  const nojson = errors.find(
    (e) => e.error === json.ParseErrorCode.InvalidSymbol,
  );
  if (errors.length > 0 && nojson) {
    return { type: "message", line };
  }
  return parseResult(parsed);
}

export function parseResult(parsed: ITestResult): Result {
  if (parsed.event === "runStart") {
    const event: RunEvent = {
      tag: "runStart",
      testCount: Number.parseInt(parsed.testCount),
    };
    return { type: "result", event };
  }
  if (parsed.event === "runComplete") {
    const event: RunEvent = {
      tag: "runComplete",
      passed: Number.parseInt(parsed.passed),
      failed: Number.parseInt(parsed.failed),
      duration: Number.parseInt(parsed.duration),
    };
    return { type: "result", event };
  }
  if (parsed.event === "testCompleted") {
    const status: TestStatus = parseStatus(parsed);
    if (status) {
      const messages: string[] =
        parsed.messages?.map((m: string) => String(m)) ?? [];
      const event: RunEvent = {
        tag: "testCompleted",
        labels: parsed.labels,
        messages,
        duration: Number.parseInt(parsed.duration),
        status,
      };
      return { type: "result", event };
    }
  }
  throw new Error(`unknown event ${parsed.event}`);
}

function parseStatus(parsed: ITestResult): TestStatus {
  if (parsed.status === "pass") {
    return { tag: "pass" };
  } else if (parsed.status === "todo") {
    const comment = String(parsed.failures[0]);
    return { tag: "todo", comment };
  } else if (parsed.status === "fail") {
    const failures = (parsed.failures as any[]).map(parseFailure);
    return { tag: "fail", failures };
  }
  throw new Error(`unknown status ${parsed.status}`);
}

function parseFailure(failure: any): Failure {
  if (typeof failure.reason.data === "object") {
    const data: any = failure.reason.data;
    if (data.comparison) {
      return {
        tag: "comparison",
        actual: parseInnerJson(String(data.actual)),
        expected: parseInnerJson(String(data.expected)),
        comparison: String(data.comparison),
      };
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const dataMap = Object.keys(data)
        .map((key) => [String(key), String(data[key])])
        .reduce(
          (obj, [key, value]) => Object.assign(obj, { [key]: value }),
          {},
        );
      return {
        tag: "data",
        data: dataMap,
      };
    }
  } else if (failure.reason.data) {
    return {
      tag: "message",
      message: String(failure.reason.data),
    };
  } else if (failure.message) {
    return {
      tag: "message",
      message: String(failure.message),
    };
  }
  throw new Error(`unknown failure ${JSON.stringify(failure)}`);
}

export function parseErrorOutput(line: string): ErrorOutput {
  const errors: json.ParseError[] = [];
  const output: CompileErrors = json.parse(line, errors);
  if (output) {
    return output;
  }
  return { type: "message", line };
}

export type Output = Message | Result;

export type ErrorOutput = Message | CompileErrors;

export type Message = {
  type: "message";
  line: string;
};

export type Result = {
  type: "result";
  event: RunEvent;
};

export type RunEvent =
  | { tag: "runStart"; testCount: number }
  | TestCompleted
  | { tag: "runComplete"; passed: number; failed: number; duration: number };

export type TestCompleted = {
  tag: "testCompleted";
  labels: string[];
  messages: string[];
  duration: number;
  status: TestStatus;
};

export type TestStatus =
  | { tag: "pass" }
  | { tag: "todo"; comment: string }
  | { tag: "fail"; failures: Failure[] };

export type Failure =
  | { tag: "message"; message: string }
  | {
      tag: "comparison";
      comparison: string;
      actual: string;
      expected: string;
    }
  | { tag: "data"; data: { [key: string]: string } };

export type CompileErrors = {
  type: "compile-errors";
  errors: Error[];
};

export type Error = {
  path: string;
  name: string;
  problems: Problem[];
};

export type Problem = {
  title: string;
  region: Region;
  message: MessagePart[];
};

export type Region = {
  start: Position;
  end: Position;
};

export type Position = {
  line: number;
  column: number;
};

export type MessagePart = string | StyledString;

export type StyledString = {
  bold?: boolean;
  underline?: boolean;
  color?: string;
  string: string;
};

export function buildMessage(event: TestCompleted): string | undefined {
  if (event.status.tag === "fail") {
    const lines = event.status.failures.flatMap((failure) => {
      switch (failure.tag) {
        case "comparison":
          return [failure.actual, "| " + failure.comparison, failure.expected];
        case "data":
          return Object.keys(failure.data).map(
            (key) => `${key}: ${failure.data[key]}`,
          );
        case "message":
          return [failure.message];
      }
    });
    return event.messages.concat(lines).join("\n");
  }
  return event.messages.join("\n");
}

function parseInnerJson(value: string): string {
  if (value && value.startsWith('"')) {
    return String(json.parse(value));
  }
  return value;
}

export function buildErrorMessage(output: ErrorOutput): string {
  switch (output.type) {
    case "message":
      return output.line;
    case "compile-errors":
      return buildCompileErrorsMessages(output.errors);
  }
}

function buildCompileErrorsMessages(errors: Error[]): string {
  return errors.map(buildCompileErrorMessage).join("\n\n");
}

function buildCompileErrorMessage(error: Error): string {
  return [`${error.path}`]
    .concat(error.problems.map(buildProblemMessage))
    .join("\n\n");
}

function buildProblemMessage(problem: Problem): string {
  return [`${buildRegion(problem.region)} ${problem.title}\n`]
    .concat(problem.message.map(getMessageString))
    .join("");
}

function buildRegion(region: Region): string {
  return `${buildPosition(region.start)}-${buildPosition(region.end)}`;
}

function buildPosition(pos: Position): string {
  return `${pos.line}:${pos.column}`;
}

function getMessageString(message: MessagePart): string {
  return typeof message === "string" ? message : message["string"];
}
