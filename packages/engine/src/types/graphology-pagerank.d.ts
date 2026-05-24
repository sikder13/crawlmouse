declare module 'graphology-pagerank' {
  import type Graph from 'graphology';
  interface PageRankOptions {
    alpha?: number;
    maxIterations?: number;
    tolerance?: number;
    getEdgeWeight?: string | null | ((edge: string) => number);
  }
  function pagerank<NodeAttrs = unknown, EdgeAttrs = unknown>(
    graph: Graph<NodeAttrs, EdgeAttrs>,
    options?: PageRankOptions,
  ): Record<string, number>;
  export default pagerank;
}
