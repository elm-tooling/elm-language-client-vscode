import { CodeActionParams, RequestType } from "vscode-languageclient";

export const GetMoveDestinationRequest = new RequestType<
  MoveParams,
  MoveDestinationsResponse,
  void,
  void
>("elm/getMoveDestinations");

export const MoveRequest = new RequestType<MoveParams, void, void, void>(
  "elm/move",
);

export interface MoveParams {
  sourceUri: string;
  params: CodeActionParams;
  destination?: MoveDestination;
}

export interface MoveDestinationsResponse {
  destinations: MoveDestination[];
}

export interface MoveDestination {
  name: string;
  path: string;
  uri: string;
}
