// Copyright 2021 Frank Wagner. Licensed under the MIT License; see LICENSE.
import type { TestCompleted } from "./result";

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
  return `${event.labels[0].split(".").join("/")}.elm`;
}
