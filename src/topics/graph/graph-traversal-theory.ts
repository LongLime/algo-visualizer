import { BookOpen, Gauge, ListChecks, TriangleAlert } from "lucide-react";
import type { TheoryBlock } from "../types";

export const graphTraversalTheory: readonly TheoryBlock[] = [
  {
    title: "核心思路",
    icon: BookOpen,
    body: "图的遍历就是从一个起点出发，把能够到达的顶点依次访问一遍。BFS 使用队列，像一圈一圈向外扩散；DFS 沿着一条路径尽量深入，走不通时再回到上一个分岔点。两种方法都会用 visited 记录已经发现的顶点。",
    items: [
      "BFS：先发现起点的邻居，再发现下一层邻居，队列保证先进先出。",
      "DFS：访问一个顶点后继续访问未访问的邻居，递归栈记录当前路径。",
      "无向图要把一条边看成两个方向；本示例从 A 到 F 使用邻接表保存邻居。",
    ],
  },
  {
    title: "每一步怎么走",
    icon: ListChecks,
    body: "BFS 和 DFS 都从 A 开始，但保存“下一步访问谁”的方式不同。看动画时，可以把队列理解为 BFS 的待办清单，把调用栈理解为 DFS 当前走到的路径。",
    items: [
      "BFS（队列）：① 将起点 A 入队并标记；② 取出队首 A，扫描它的全部邻居；③ 发现 B、C 后依次放入队尾，队列变成 [B, C]；④ 取出 B，再把尚未发现的邻居放到队尾；⑤ 重复直到队列为空。",
      "DFS（递归栈）：① 访问起点 A 并入栈；② 选择 A 的一个未访问邻居 B，继续深入；③ 从 B 继续走到 D 等更深顶点；④ 当前顶点没有未访问邻居时回溯，弹出它并回到上一层；⑤ 换一个分支继续，直到栈为空。",
      "两种方法都在顶点第一次发现时标记 visited。这样即使图中有环，顶点也不会被重复加入队列或递归。",
      "图可能有多个连通分量：从一个起点开始的遍历只覆盖该起点可达的部分。",
    ],
  },
  {
    title: "复杂度",
    icon: Gauge,
    body: "使用邻接表时，每个顶点最多访问一次，每条边最多检查一次（无向图会从两个端点各检查一次，常数不影响数量级）。",
    rows: [
      { label: "BFS 时间", value: "O(V + E)" },
      { label: "DFS 时间", value: "O(V + E)" },
      { label: "visited、队列或递归栈空间", value: "O(V)" },
    ],
  },
  {
    title: "易错点与适用场景",
    icon: TriangleAlert,
    body: "遍历代码通常不长，错误集中在访问标记和边界处理。先明确“发现”与“取出”的时机，再写循环会更容易检查。",
    items: [
      "不要等顶点出队或递归返回后才标记 visited，否则同一顶点可能被重复加入。",
      "BFS 的队列不能当栈使用；DFS 的递归或显式栈也不能按队列顺序弹出。",
      "若要判断无权图的最少边数，优先使用 BFS；若要深入搜索、检测连通区域或生成回溯路径，可使用 DFS。",
    ],
  },
];
