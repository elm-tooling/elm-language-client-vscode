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

import { TestSuiteInfo } from "vscode-test-adapter-api";
import {
  walk,
  getFilesAndAllTestIds,
  IElmBinaries,
  buildElmTestArgs,
  buildElmTestArgsWithReport,
  getFilePath,
  mergeTopLevelSuites,
} from "../util";
import { expect } from "chai";

describe("util", () => {
  const suiteWithoutChildren: TestSuiteInfo = {
    type: "suite",
    id: "a",
    label: "a",
    children: [],
  };

  const suiteWithFiles: TestSuiteInfo = {
    type: "suite",
    id: "a",
    label: "a",
    file: "file0",
    children: [
      {
        type: "test",
        id: "a/b",
        label: "b",
        file: "file2",
      },
      {
        type: "test",
        id: "a/c",
        label: "c",
        file: "file1",
      },
      {
        type: "test",
        id: "a/d",
        label: "d",
        file: "file2",
      },
    ],
  };

  describe("walk suite", () => {
    it("no children", () => {
      const walked = Array.from(walk(suiteWithoutChildren));
      expect(walked).to.eql([suiteWithoutChildren]);
    });

    it("depth first", () => {
      const suite: TestSuiteInfo = {
        type: "suite",
        id: "a",
        label: "a",
        children: [
          {
            type: "suite",
            id: "a/b",
            label: "b",
            children: [
              {
                type: "test",
                id: "a/b/c",
                label: "c",
              },
              {
                type: "test",
                id: "a/b/d",
                label: "d",
              },
            ],
          },
          {
            type: "suite",
            id: "a/e",
            label: "e",
            children: [],
          },
        ],
      };
      const walked = Array.from(walk(suite));
      expect(walked.map((n) => n.label)).to.eql(["a", "b", "c", "d", "e"]);
    });
  });

  describe("find files for tests", () => {
    it("empty", () => {
      const ids = ["x"];
      const [files, allIds] = getFilesAndAllTestIds(ids, suiteWithoutChildren);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      expect(files).to.be.empty;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      expect(allIds).to.be.empty;
    });

    it("two tests", () => {
      const ids = ["a/b"];
      const [files, allIds] = getFilesAndAllTestIds(ids, suiteWithFiles);
      expect(files).to.eql(["file2"]);
      expect(allIds).to.eql(["a/b", "a/d"]);
    });

    it("unique file names", () => {
      const ids = ["a/b", "a/d"];
      const [files, allIds] = getFilesAndAllTestIds(ids, suiteWithFiles);
      expect(files).to.eql(["file2"]);
      expect(allIds).to.eql(["a/b", "a/d"]);
    });
  });

  describe("get elm-test args", () => {
    it("without anything", () => {
      const binaries: IElmBinaries = {};
      const args = buildElmTestArgs(binaries);
      expect(args).to.eql(["elm-test"]);
    });

    it("with local elm-test", () => {
      const binaries: IElmBinaries = {
        elmTest: "local/elm-test",
      };
      const args = buildElmTestArgs(binaries);
      expect(args).to.eql(["local/elm-test"]);
    });

    it("with local elm compiler (0.19)", () => {
      const binaries: IElmBinaries = {
        elmTest: "local/elm-test",
        elm: "local/elm",
      };
      const args = buildElmTestArgs(binaries);
      expect(args).to.eql(["local/elm-test", "--compiler", "local/elm"]);
    });

    it("with files", () => {
      const binaries: IElmBinaries = {
        elmTest: "local/elm-test",
        elm: "local/elm",
      };
      const files = ["file1", "file2"];
      const args = buildElmTestArgs(binaries, files);
      expect(args).to.eql([
        "local/elm-test",
        "--compiler",
        "local/elm",
        "file1",
        "file2",
      ]);
    });

    it("with report", () => {
      const args: string[] = ["path/elm-test", "file"];
      const withReport = buildElmTestArgsWithReport(args);
      expect(withReport).to.eql(["path/elm-test", "file", "--report", "json"]);
    });
  });

  describe("getFilePathUnderTests", () => {
    it("top level", () => {
      const path = getFilePath({
        tag: "testCompleted",
        labels: ["Module"],
        messages: [],
        status: { tag: "pass" },
        duration: 13,
      });
      expect(path).to.eq("Module.elm");
    });
    it("first level", () => {
      const path = getFilePath({
        tag: "testCompleted",
        labels: ["Module.Sub"],
        messages: [],
        status: { tag: "pass" },
        duration: 13,
      });
      expect(path).to.eq("Module/Sub.elm");
    });
    it("deeper level", () => {
      const path = getFilePath({
        tag: "testCompleted",
        labels: ["Module.Sub.Deep"],
        messages: [],
        status: { tag: "pass" },
        duration: 13,
      });
      expect(path).to.eq("Module/Sub/Deep.elm");
    });
  });

  describe("merge test suites", () => {
    const to: TestSuiteInfo = {
      type: "suite",
      id: "top",
      label: "top",
      file: "file1",
      line: 1,
      children: [
        {
          type: "suite",
          id: "a/b",
          label: "b",
          file: "file2",
          line: 2,
          children: [
            {
              type: "suite",
              id: "a/b/deep",
              label: "deep",
              file: "file2",
              line: 22,
              children: [],
            },
          ],
        },
        {
          type: "suite",
          id: "a/e",
          label: "e",
          file: "file3",
          line: 3,
          children: [],
        },
      ],
    };
    it("mismatched", () => {
      const from: TestSuiteInfo = {
        type: "suite",
        id: "another-top",
        label: "another top",
        children: [
          {
            type: "suite",
            id: "c",
            label: "c",
            children: [],
          },
        ],
      };
      expect(mergeTopLevelSuites(from, to)).to.eql({
        type: "suite",
        id: "top",
        label: "top",
        file: "file1",
        line: 1,
        children: [
          {
            type: "suite",
            id: "a/b",
            label: "b",
            file: "file2",
            line: 2,
            children: [
              {
                type: "suite",
                id: "a/b/deep",
                label: "deep",
                file: "file2",
                line: 22,
                children: [],
              },
            ],
          },
          {
            type: "suite",
            id: "a/e",
            label: "e",
            file: "file3",
            line: 3,
            children: [],
          },
          {
            type: "suite",
            id: "another-top",
            label: "another top",
            children: [
              {
                type: "suite",
                id: "c",
                label: "c",
                children: [],
              },
            ],
          },
        ],
      });
    });

    it("replace one", () => {
      const from: TestSuiteInfo = {
        type: "suite",
        id: "top",
        label: "top",
        children: [
          {
            type: "suite",
            id: "a/b",
            label: "new b",
            children: [],
          },
        ],
      };
      expect(mergeTopLevelSuites(from, to)).to.eql({
        type: "suite",
        id: "top",
        label: "top",
        file: "file1",
        line: 1,
        children: [
          {
            type: "suite",
            id: "a/b",
            label: "new b",
            file: "file2",
            line: 2,
            children: [],
          },
          {
            type: "suite",
            id: "a/e",
            label: "e",
            file: "file3",
            line: 3,
            children: [],
          },
        ],
      });
    });

    it("replace one and keep deep location", () => {
      const from: TestSuiteInfo = {
        type: "suite",
        id: "top",
        label: "top",
        children: [
          {
            type: "suite",
            id: "a/b",
            label: "new b",
            children: [
              {
                type: "suite",
                id: "a/b/deep",
                label: "new deep",
                children: [],
              },
            ],
          },
        ],
      };
      expect(mergeTopLevelSuites(from, to)).to.eql({
        type: "suite",
        id: "top",
        label: "top",
        file: "file1",
        line: 1,
        children: [
          {
            type: "suite",
            id: "a/b",
            label: "new b",
            file: "file2",
            line: 2,
            children: [
              {
                type: "suite",
                id: "a/b/deep",
                label: "new deep",
                file: "file2",
                line: 22,
                children: [],
              },
            ],
          },
          {
            type: "suite",
            id: "a/e",
            label: "e",
            file: "file3",
            line: 3,
            children: [],
          },
        ],
      });
    });

    it("append one", () => {
      const from: TestSuiteInfo = {
        type: "suite",
        id: "top",
        label: "top",
        children: [
          {
            type: "suite",
            id: "a/d",
            label: "new d",
            children: [],
          },
        ],
      };
      expect(mergeTopLevelSuites(from, to)).to.eql({
        type: "suite",
        id: "top",
        label: "top",
        file: "file1",
        line: 1,
        children: [
          {
            type: "suite",
            id: "a/b",
            label: "b",
            file: "file2",
            line: 2,
            children: [
              {
                type: "suite",
                id: "a/b/deep",
                label: "deep",
                file: "file2",
                line: 22,
                children: [],
              },
            ],
          },
          {
            type: "suite",
            id: "a/e",
            label: "e",
            file: "file3",
            line: 3,
            children: [],
          },
          {
            type: "suite",
            id: "a/d",
            label: "new d",
            children: [],
          },
        ],
      });
    });
  });
});
