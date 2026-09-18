import { parseOutput } from "./result";
import { insertRunTestData, RunTestSuite } from "./runTestSuite";

/** Parse a complete elm-test JSON report, rejecting missing or corrupt results. */
export function readReport(text: string): RunTestSuite {
  let suite: RunTestSuite = {
    type: "suite",
    id: "",
    label: "root",
    children: [],
  };
  let count: number | undefined;
  let completed = 0;
  let finished = false;
  let messages: string[] = [];
  for (const line of text.split(/\r?\n/).filter((line) => line.trim())) {
    const output = parseOutput(line, true);
    if (output.type === "message") {
      messages.push(output.line);
      continue;
    }
    if (finished)
      throw new Error("Unexpected result after elm-test runComplete");
    switch (output.event.tag) {
      case "runStart":
        if (
          count !== undefined ||
          !Number.isInteger(output.event.testCount) ||
          output.event.testCount < 1
        ) {
          throw new Error("Invalid elm-test runStart");
        }
        count = output.event.testCount;
        break;
      case "testCompleted":
        if (count === undefined) throw new Error("Missing elm-test runStart");
        suite = insertRunTestData(suite, {
          ...output.event,
          // elm-test puts a todo's description in failures, not in labels.
          labels:
            output.event.status.tag === "todo"
              ? [...output.event.labels, output.event.status.comment]
              : output.event.labels,
          messages: [...messages, ...output.event.messages],
        });
        messages = [];
        completed++;
        break;
      case "runComplete":
        if (output.event.autoFail) throw new Error(output.event.autoFail);
        finished = true;
        break;
    }
  }
  if (!finished || count === undefined || completed !== count) {
    throw new Error("elm-test returned an incomplete report");
  }
  return suite;
}
