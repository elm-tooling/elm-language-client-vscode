export type TestNode = {
  id: string;
  file?: string;
  children?: TestNode[];
};

export function testId(labels: readonly string[]): string {
  return JSON.stringify(labels);
}

/** elm-test selects files, so an included leaf also runs its file's siblings. */
export function selectFiles(
  root: TestNode,
  include: readonly string[] | undefined,
  exclude: readonly string[],
): string[] {
  const files = new Set<string>();
  const visit = (node: TestNode, selected: boolean): void => {
    if (exclude.includes(node.id)) {
      return;
    }
    selected ||= include === undefined || include.includes(node.id);
    if (node.children?.length) {
      node.children.forEach((child) => visit(child, selected));
    } else if (selected && node.file) {
      files.add(node.file);
    }
  };
  visit(root, false);
  return [...files];
}
