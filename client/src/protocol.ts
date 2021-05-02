import { CodeActionParams, RequestType, URI } from "vscode-languageclient";

export const GetMoveDestinationRequest = new RequestType<
  IMoveParams,
  IMoveDestinationsResponse,
  void
>("elm/getMoveDestinations");

export const MoveRequest = new RequestType<IMoveParams, void, void>("elm/move");

export interface IMoveParams {
  sourceUri: string;
  params: CodeActionParams;
  destination?: IMoveDestination;
}

export interface IMoveDestinationsResponse {
  destinations: IMoveDestination[];
}

export interface IMoveDestination {
  name: string;
  path: string;
  uri: string;
}

export const ExposeRequest = new RequestType<IExposeUnexposeParams, void, void>(
  "elm/expose",
);

export interface IExposeUnexposeParams {
  uri: string;
  name: string;
}

export const UnexposeRequest = new RequestType<
  IExposeUnexposeParams,
  void,
  void
>("elm/unexpose");

export const FindTestsRequest = new RequestType<
  IFindTestsParams,
  IFindTestsResponse,
  void
>("elm/findTests");

export interface IFindTestsParams {
  workspaceRoot: URI;
}

export interface IFindTestsResponse {
  suites?: TestSuite[];
}

export type TestSuite = {
  label: string | string[];
  tests?: TestSuite[];
  file: string;
  position: { line: number; character: number };
};
