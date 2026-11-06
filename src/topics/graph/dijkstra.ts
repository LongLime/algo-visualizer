import { Route } from "lucide-react";
import { parseCode } from "../../core/code";
import type { Frame } from "../../core/types";
import type { ReadyTopic } from "../types";
import { dijkstraTheory } from "./dijkstra-theory";

const edges: Array<[number, number, number]> = [
  [0, 1, 4], [0, 2, 2], [1, 3, 5], [1, 4, 3], [2, 4, 1], [2, 5, 7], [4, 5, 2],
];
const labels = ["A", "B", "C", "D", "E", "F"];
const templates = {
  C: `void dijkstra(int start) { // @start
  dist[start] = 0; // @initialize
  for (int step = 0; step < n; step++) {
    int u = selectMinUnvisited(); // @select
    used[u] = 1; // @settle
    for (int v = 0; v < n; ++v) { // @scan
      if (graph[u][v] >= 0 && dist[u] + graph[u][v] < dist[v]) relax(u, v, graph[u][v]); // @relax
    }
  }
} // @done`,
  Python: `def dijkstra(start): # @start
    dist[start] = 0 # @initialize
    for _ in range(n):
        u = select_min_unvisited() # @select
        used[u] = True # @settle
        for v, weight in graph[u]: # @scan
            if dist[u] + weight < dist[v]: relax(u, v, weight) # @relax
# @done`,
  "C++": `void dijkstra(int start) { // @start
  dist[start] = 0; // @initialize
  for (int step = 0; step < n; ++step) {
    int u = selectMinUnvisited(); // @select
    used[u] = true; // @settle
    for (auto [v, w] : graph[u]) { // @scan
      if (dist[u] + w < dist[v]) relax(u, v, w); // @relax
    }
  }
} // @done`,
  Go: `func dijkstra(start int) { // @start
    dist[start] = 0 // @initialize
    for step := 0; step < n; step++ {
        u := selectMinUnvisited() // @select
        used[u] = true // @settle
        for _, edge := range graph[u] { // @scan
            if dist[u]+edge.weight < dist[edge.to] { relax(u, edge.to) } // @relax
        }
    }
} // @done`,
  Java: `void dijkstra(int start) { // @start
  dist[start] = 0; // @initialize
  for (int step = 0; step < n; step++) {
    int u = selectMinUnvisited(); // @select
    used[u] = true; // @settle
    for (Edge e : graph[u]) { // @scan
      if (dist[u] + e.weight < dist[e.to]) relax(u, e.to, e.weight); // @relax
    }
  }
} // @done`,
  Rust: `fn dijkstra(start: usize) { // @start
    dist[start] = 0; // @initialize
    for _ in 0..n {
        let u = select_min_unvisited(); // @select
        used[u] = true; // @settle
        for &(v, weight) in &graph[u] { // @scan
            if dist[u] + weight < dist[v] { relax(u, v, weight); } // @relax
        }
    }
} // @done`,
} as const;

export function dijkstraTrace(start: number): Frame[] {
  if (!Number.isInteger(start) || start < 0 || start >= labels.length) throw new Error("起始顶点请输入 0 到 5 之间的整数。");
  const adjacency = Array.from({ length: labels.length }, () => [] as Array<[number, number]>);
  for (const [a, b, w] of edges) { adjacency[a].push([b, w]); adjacency[b].push([a, w]); }
  const dist = Array(labels.length).fill(Infinity) as number[];
  const used = new Set<number>();
  const items = labels.map((_, id) => ({ id, value: id }));
  const frames: Frame[] = [];
  let currentEdge: string | undefined;
  const edgeWeights = Object.fromEntries(edges.flatMap(([a, b, w]) => [[`${a}-${b}`, w], [`${b}-${a}`, w]]));
  const emit = (anchor: string, narration: string, active: number[] = [], settled: number[] = [], pointers: Record<string, number> = {}) => frames.push({ items: items.map((item) => ({ ...item })), links: edges.map(([a, b]) => [a, b]), edgeWeights, active, settled, pointers, anchor, narration, variables: { start, distances: dist.map((n) => Number.isFinite(n) ? n : "∞").join(","), ...(currentEdge ? { edge: currentEdge } : {}) }, stack: [] });
  dist[start] = 0;
  emit("start", `从 ${labels[start]} 出发，初始化距离。`, [start], [], { current: start });
  while (used.size < labels.length) {
    let u = -1;
    for (let i = 0; i < dist.length; i++) if (!used.has(i) && dist[i] < (u < 0 ? Infinity : dist[u])) u = i;
    if (u < 0) break;
    currentEdge = undefined;
    emit("select", `选择当前距离最小的未确定顶点 ${labels[u]}（距离 ${dist[u]}）。`, [u], [...used], { current: u });
    used.add(u);
    emit("settle", `确定 ${labels[u]} 的最短距离为 ${dist[u]}。`, [u], [...used], { current: u });
    for (const [v, weight] of adjacency[u]) {
      currentEdge = `${u}-${v}`;
      emit("scan", `检查边 ${labels[u]} - ${labels[v]}，权重 ${weight}。`, [u, v], [...used], { current: u, neighbor: v });
      if (!used.has(v) && dist[u] + weight < dist[v]) {
        dist[v] = dist[u] + weight;
        emit("relax", `松弛 ${labels[v]}，更新距离为 ${dist[v]}。`, [v], [...used], { current: u, neighbor: v });
      }
    }
  }
  currentEdge = undefined;
  emit("done", `最短距离计算完成：${dist.map((d, i) => `${labels[i]}=${d}`).join("，")}。`, [], [...used]);
  return frames;
}

export const dijkstra: ReadyTopic = {
  id: "dijkstra", group: "graph", title: "最短路径", badge: "O(V^2 + E)", summary: "在带非负权图上逐步选择最小距离并松弛邻接边。", status: "ready", scene: "graph", icon: Route,
  controls: { dataLabel: "起始顶点（0=A，5=F）", defaultValues: [0], limit: 1, randomValues: () => [Math.floor(Math.random() * 6)] },
  legend: [{ label: "当前操作", tone: "active" }, { label: "已确定", tone: "settled" }, { label: "未处理", tone: "idle" }],
  theory: dijkstraTheory,
  trace: ({ values }) => dijkstraTrace(values[0] ?? 0),
  code: (language) => parseCode(templates[language]),
};
