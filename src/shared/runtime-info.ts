import manifest from "../../package.json";

export type RuntimeInfo = {
  app: string;
  version: string;
  runtime: {
    node: string;
    sqlite: string | null;
  };
};

export function getRuntimeInfo(): RuntimeInfo {
  return {
    app: manifest.title,
    version: manifest.version,
    runtime: {
      node: process.versions.node,
      sqlite: process.versions.sqlite ?? null,
    },
  };
}
