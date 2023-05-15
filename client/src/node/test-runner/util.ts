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
import { TestSuiteInfo, TestInfo } from "vscode-test-adapter-api";
import { TestCompleted } from "./result";

export function* walk(
  node: TestSuiteInfo | TestInfo,
): Generator<TestSuiteInfo | TestInfo> {
  yield node;
  if (node.type === "suite") {
    for (const child of node.children) {
      for (const c of walk(child)) {
        yield c;
      }
    }
  }
}

export function getFilesAndAllTestIds(
  ids: string[],
  suite: TestSuiteInfo,
): [string[], string[]] {
  const selectedIds = new Set(ids);
  const files = Array.from(walk(suite))
    .filter((node) => selectedIds.has(node.id))
    .filter((node) => node.file)
    .map((node) => node.file ?? "?"); // make TS happy

  const selectedFiles = new Set(files);
  const allIds = Array.from(walk(suite))
    .filter((node) => node.file)
    .filter((node) => node.file && selectedFiles.has(node.file)) // make TS happy
    .map((node) => node.id ?? "?"); // make TS happy

  return [Array.from(selectedFiles), allIds];
}

export function getTestIdsForFile(
  fileName: string,
  suite: TestSuiteInfo,
): string[] {
  return Array.from(walk(suite))
    .filter((node) => node.file === fileName)
    .map((node) => node.id);
}

export interface IElmBinaries {
  elmTest?: string;
  elm?: string;
}

export function buildElmTestArgs(
  binaries: IElmBinaries,
  files?: string[],
): string[] {
  return [binaries.elmTest ?? "elm-test"]
    .concat((binaries.elm && ["--compiler", binaries.elm]) ?? [])
    .concat(files ?? []);
}

export function buildElmTestArgsWithReport(args: string[]): string[] {
  return args.concat(["--report", "json"]);
}

export function getFilePath(event: TestCompleted): string {
  const module = event.labels[0];
  const file = module.split(".").join("/");
  return `${file}.elm`;
}

export function getTestsRoot(elmProjectFolder: string): string {
  return `${elmProjectFolder}/tests`;
}

export function mergeTopLevelSuites(
  from: TestSuiteInfo,
  to: TestSuiteInfo,
): TestSuiteInfo {
  if (to.id === from.id) {
    const from1 = copyLocations(to, from);
    const byId: Map<string, TestSuiteInfo | TestInfo> = new Map(
      from1.children.map((node) => [node.id, node]),
    );
    const ids: Set<string> = new Set(to.children.map((c) => c.id));
    const children = to.children.map((c) => byId.get(c.id) ?? c);
    const newSuites = Array.from(byId.values()).filter((e) => !ids.has(e.id));
    return <TestSuiteInfo>{
      ...to,
      children: [...children, ...newSuites],
    };
  }
  return <TestSuiteInfo>{
    ...to,
    children: [...to.children, from],
  };
}

export function copyLocations(
  source: TestSuiteInfo,
  dest: TestSuiteInfo,
): TestSuiteInfo {
  const byId = new Map(Array.from(walk(source)).map((node) => [node.id, node]));
  const go = (node: TestSuiteInfo | TestInfo): TestSuiteInfo | TestInfo => {
    const found = byId.get(node.id);
    if (node.type === "suite") {
      const children = node.children.map(go);
      return found
        ? { ...node, children, file: found.file, line: found.line }
        : { ...node, children };
    }
    return found ? { ...node, file: found?.file, line: found?.line } : node;
  };
  const found = byId.get(dest.id);
  const children = dest.children.map(go);
  return found
    ? { ...dest, children, file: found.file, line: found.line }
    : { ...dest, children };
}

export function getLineFun(
  suite: TestSuiteInfo,
): (id: string) => number | undefined {
  const byId = new Map(
    Array.from(walk(suite))
      .filter((node) => node.line !== undefined)
      .map((node) => [node.id, node.line]),
  );
  return (id: string) => byId.get(id);
}

export function abreviateToOneLine(text: string): string {
  const text1 = text.split("\n").join(" ");
  if (text1.length > 20) {
    return text1.substr(0, 20) + " ...";
  }
  return text1;
}
