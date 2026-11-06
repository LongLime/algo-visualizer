import { Network } from "lucide-react";
import { parseCode } from "../../core/code";
import type { Frame } from "../../core/types";
import type { ReadyTopic } from "../types";
import { templates } from "./graph-traversal-templates";
import { graphTraversalTheory } from "./graph-traversal-theory";

export const GRAPH_EDGES: Array<[number, number]> = [
  [0, 1], [0, 2], [1, 3], [1, 4], [2, 4], [2, 5], [4, 5],
];
const labels = ["A", "B", "C", "D", "E", "F"];

function graphTrace(start: number, operation: "bfs" | "dfs"): Frame[] {
  if (!Number.isInteger(start) || start < 0 || start >= labels.length)
    throw new Error("起始顶点请输入 0 到 5 之间的整数。");
  const adjacency = Array.from({ length: labels.length }, () => [] as number[]);
  for (const [a, b] of GRAPH_EDGES) { adjacency[a].push(b); adjacency[b].push(a); }
  const items = labels.map((_, id) => ({ id, value: id }));
  const frames: Frame[] = [];
  const visited = new Set<number>();
  const settled: number[] = [];
  const visitOrder: number[] = [];
  const stack: string[] = [];
  let currentEdge: string | undefined;
  let queueSnapshot: number[] | undefined;
  function emit(anchor: string, narration: string, active: number[] = [], pointers: Record<string, number> = {}) {
    frames.push({ items: items.map((item) => ({ ...item })), links: GRAPH_EDGES.map((edge) => [...edge] as [number, number]), active, settled: [...settled], pointers, anchor, narration, variables: { operation, start, ...(currentEdge ? { edge: currentEdge } : {}) }, stack: [...stack], queue: queueSnapshot ? [...queueSnapshot] : undefined });
  }
  emit("start", `从顶点 ${labels[start]} 开始${operation === "bfs" ? "广度" : "深度"}优先遍历。`, [start], { current: start });
  visited.add(start);
  if (operation === "bfs") {
    const queue = [start];
    queueSnapshot = queue;
    emit("enqueue", `将 ${labels[start]} 放入队列。`, [start], { current: start });
    while (queue.length) {
      const u = queue.shift()!;
      queueSnapshot = queue;
      visitOrder.push(u);
      settled.push(u);
      emit("dequeue", `取出队首 ${labels[u]}，检查它的邻接顶点。`, [u], { current: u });
      for (const v of adjacency[u]) {
        currentEdge = `${u}-${v}`;
        emit("scan", `检查边 ${labels[u]} - ${labels[v]}。`, [u, v], { current: u, neighbor: v });
        if (!visited.has(v)) {
          visited.add(v); queue.push(v);
          queueSnapshot = queue;
          emit("discover", `发现 ${labels[v]}，加入队列。`, [v], { current: u, neighbor: v });
        }
      }
    }
  } else {
    function visit(u: number) {
      visited.add(u); visitOrder.push(u); stack.push(labels[u]);
      emit("visit", `访问顶点 ${labels[u]}。`, [u], { current: u });
      for (const v of adjacency[u]) {
        currentEdge = `${u}-${v}`;
        emit("scan", `从 ${labels[u]} 检查边 ${labels[u]} - ${labels[v]}。`, [u, v], { current: u, neighbor: v });
        if (!visited.has(v)) { emit("recurse", `沿边进入 ${labels[v]}。`, [u, v], { current: u, neighbor: v }); visit(v); }
      }
      settled.push(u); stack.pop();
      emit("backtrack", `完成 ${labels[u]}，回溯到上一层。`, [u], { current: u });
    }
    visit(start);
  }
  currentEdge = undefined;
  emit("done", `遍历完成，访问顺序为 ${visitOrder.map((id) => labels[id]).join(" → ")}。`, [], {});
  return frames;
}

export const graphTraversal: ReadyTopic = {
  id: "graph-traversal", group: "graph", title: "图的遍历", badge: "O(V+E)",
  summary: "在二维图上演示 BFS 与 DFS 的访问顺序、队列和递归回溯。", status: "ready", scene: "graph", icon: Network,
  controls: { dataLabel: "起始顶点（0=A，5=F）", defaultValues: [0], limit: 1, randomValues: () => [Math.floor(Math.random() * 6)], operations: [{ id: "bfs", label: "BFS 广度优先" }, { id: "dfs", label: "DFS 深度优先" }] },
  legend: [{ label: "当前访问", tone: "active" }, { label: "已完成", tone: "settled" }, { label: "未访问", tone: "idle" }],
  theory: graphTraversalTheory,
  trace: ({ values, operation }) => graphTrace(values[0] ?? 0, operation === "dfs" ? "dfs" : "bfs"),
  code: (language, operation) => parseCode(templates[language][operation === "dfs" ? "dfs" : "bfs"]),
};
