import {
  BookOpen,
  Gauge,
  Network,
  ScanLine,
  TriangleAlert,
} from "lucide-react";
import { parseCode } from "../../core/code";
import type { Frame, FrameLink, TraceInput } from "../../core/types";
import type { ReadyTopic } from "../types";
import { templates } from "./binary-tree-templates";

const MAX_TOKENS = 31;
const MAX_NODES = 15;
const DEFAULT_INPUT = "1, 2, 4, #, #, 5, #, #, 3, 6, #, #, 7, #, #";

interface TreeNode {
  id: number;
  value: number;
  left: TreeNode | null;
  right: TreeNode | null;
  parent: TreeNode | null;
  side: "left" | "right" | null;
  depth: number;
}

/** 把前序序列解析为记号数组；`NaN` 作为 `#` 空位哨兵。 */
export function parseTreeInput(text: string, limit = MAX_TOKENS): number[] {
  const tokens = text
    .trim()
    .split(/[,，\s]+/)
    .filter(Boolean);
  if (!tokens.length)
    throw new Error("请输入前序序列，例如 `1, 2, #, #, 3, #, #`。");
  if (tokens.length > limit)
    throw new Error("最多展示 15 个节点，请减小输入规模。");
  let count = 0;
  return tokens.map((token) => {
    if (token === "#" || token.toLowerCase() === "null") return NaN;
    if (!/^[+-]?\d+$/.test(token))
      throw new Error(`无法识别记号 \`${token}\`，请使用整数或 \`#\`。`);
    const value = Number(token);
    if (Math.abs(value) > 999)
      throw new Error("节点值须为 -999 到 999 的整数。");
    count++;
    if (count > MAX_NODES)
      throw new Error("最多展示 15 个节点，请减小输入规模。");
    return value;
  });
}

function buildTree(tokens: number[]) {
  let pos = 0;
  const nodes: TreeNode[] = [];
  const build = (
    parent: TreeNode | null,
    side: "left" | "right" | null,
    depth: number,
  ): TreeNode | null => {
    if (pos >= tokens.length)
      throw new Error(
        "前序序列不完整：请为每个节点补齐左右孩子（用 `#` 表示空）。",
      );
    const token = tokens[pos++];
    if (Number.isNaN(token)) return null;
    if (nodes.length >= MAX_NODES)
      throw new Error("最多展示 15 个节点，请减小输入规模。");
    const node: TreeNode = {
      id: nodes.length,
      value: token,
      left: null,
      right: null,
      parent,
      side,
      depth,
    };
    nodes.push(node);
    node.left = build(node, "left", depth + 1);
    node.right = build(node, "right", depth + 1);
    return node;
  };
  const root = build(null, null, 0);
  if (!root) throw new Error("根节点不能为空。");
  if (pos < tokens.length)
    throw new Error("前序序列有多余记号：请检查 `#` 的数量。");
  return { nodes, root };
}

const RECURSIVE = {
  preorder: {
    name: "前序",
    order: "「根 → 左 → 右」",
    fn: "preorder",
    narration: (value: number) => `访问 ${value}，然后递归左子树、右子树。`,
  },
  inorder: {
    name: "中序",
    order: "「左 → 根 → 右」",
    fn: "inorder",
    narration: (value: number) => `左子树处理完，访问 ${value}，然后递归右子树。`,
  },
  postorder: {
    name: "后序",
    order: "「左 → 右 → 根」",
    fn: "postorder",
    narration: (value: number) => `左右子树处理完，访问 ${value}。`,
  },
} as const;

type RecursiveOperation = keyof typeof RECURSIVE;

export function binaryTreeTrace(values: number[], operation: string): Frame[] {
  if (!values.length)
    throw new Error("请输入前序序列，例如 `1, 2, #, #, 3, #, #`。");
  if (values.length > MAX_TOKENS)
    throw new Error("最多展示 15 个节点，请减小输入规模。");
  if (
    operation !== "create" &&
    operation !== "levelorder" &&
    !(operation in RECURSIVE)
  )
    throw new Error("未知操作。");
  const { nodes, root } = buildTree(values);
  const total = nodes.length;
  const items = nodes.map(({ id, value }) => ({ id, value }));
  const links = (visible: (node: TreeNode) => boolean) => {
    const result: FrameLink[] = [];
    for (const node of nodes) {
      if (!visible(node)) continue;
      if (node.left && visible(node.left))
        result.push([node.id, node.left.id, "left"]);
      if (node.right && visible(node.right))
        result.push([node.id, node.right.id, "right"]);
    }
    return result;
  };
  const allLinks = links(() => true);

  if (operation === "create") {
    return nodes.map((node) => {
      const done = node.id === total - 1;
      const where =
        node.side === null
          ? "创建根节点"
          : `作为 ${node.parent!.value} 的${node.side === "left" ? "左" : "右"}孩子`;
      return {
        items: items.slice(0, node.id + 1),
        links: links((candidate) => candidate.id <= node.id),
        active: [node.id],
        settled: [],
        pointers: {},
        anchor: node.side ?? "root",
        narration: `读取 ${node.value}，${where}。${done ? `建树完成，共 ${total} 个节点。` : ""}`,
        variables: { created: node.id + 1, total },
        stack: [],
        queue: [],
        rootId: 0,
      };
    });
  }

  const prepare = (queue: string[], narration: string): Frame => ({
    items,
    links: allLinks,
    active: [],
    settled: [],
    pointers: {},
    anchor: "start",
    narration,
    variables: { visited: 0, total },
    stack: [],
    queue,
    rootId: 0,
  });

  if (operation === "levelorder") {
    const frames: Frame[] = [
      prepare(
        [String(root.value)],
        `准备层序遍历：根节点 ${root.value} 入队，逐层访问。`,
      ),
    ];
    const queue: TreeNode[] = [root];
    const visited: number[] = [];
    while (queue.length) {
      const node = queue.shift()!;
      visited.push(node.id);
      const children: string[] = [];
      if (node.left) {
        queue.push(node.left);
        children.push(`左孩子 ${node.left.value}`);
      }
      if (node.right) {
        queue.push(node.right);
        children.push(`右孩子 ${node.right.value}`);
      }
      const done = queue.length === 0;
      frames.push({
        items,
        links: allLinks,
        active: [node.id],
        settled: visited.slice(0, -1),
        pointers: {},
        anchor: "visit",
        narration: `出队 ${node.value}，访问；${
          children.length ? `${children.join("、")} 入队` : "没有孩子入队"
        }。${done ? "层序遍历完成。" : ""}`,
        variables: { visited: visited.length, total },
        stack: [],
        queue: queue.map((entry) => String(entry.value)),
        rootId: 0,
      });
    }
    return frames;
  }

  const config = RECURSIVE[operation as RecursiveOperation];
  const frames: Frame[] = [
    prepare([], `准备${config.name}遍历：顺序为${config.order}。`),
  ];
  const path: number[] = [];
  const visits: { id: number; stack: number[] }[] = [];
  const walk = (node: TreeNode | null) => {
    if (!node) return;
    path.push(node.id);
    if (operation === "preorder") visits.push({ id: node.id, stack: [...path] });
    walk(node.left);
    if (operation === "inorder") visits.push({ id: node.id, stack: [...path] });
    walk(node.right);
    if (operation === "postorder") visits.push({ id: node.id, stack: [...path] });
    path.pop();
  };
  walk(root);
  visits.forEach((visit, index) => {
    const done = index === visits.length - 1;
    frames.push({
      items,
      links: allLinks,
      active: [visit.id],
      settled: visits.slice(0, index).map((entry) => entry.id),
      pointers: {},
      anchor: "visit",
      narration: `${config.narration(nodes[visit.id].value)}${done ? `${config.name}遍历完成。` : ""}`,
      variables: { visited: index + 1, total },
      stack: visit.stack.map((id) => `${config.fn}(${nodes[id].value})`),
      queue: [],
      rootId: 0,
    });
  });
  return frames;
}

export const binaryTree: ReadyTopic = {
  id: "binary-tree",
  group: "tree-hash",
  title: "二叉树遍历",
  badge: "O(n)",
  summary: "前序、中序、后序与层序遍历，对比递归栈与队列。",
  status: "ready",
  scene: "tree",
  icon: Network,
  controls: {
    dataLabel: "前序序列",
    defaultValues: [1, 2, 4, 5, 3, 6, 7],
    defaultInput: DEFAULT_INPUT,
    parseInput: parseTreeInput,
    limit: MAX_TOKENS,
    defaultOperation: "preorder",
    randomizable: false,
    operations: [
      { id: "create", label: "创建" },
      { id: "preorder", label: "前序" },
      { id: "inorder", label: "中序" },
      { id: "postorder", label: "后序" },
      { id: "levelorder", label: "层序" },
    ],
  },
  legend: [
    { label: "当前节点", tone: "pivot" },
    { label: "已访问", tone: "active" },
    { label: "未访问", tone: "idle" },
  ],
  theory: [
    {
      title: "核心思路",
      icon: BookOpen,
      body: "二叉树每个节点最多有两个孩子：左孩子和右孩子。遍历，就是按一条固定的路线把每个节点都访问一次。本演示的输入用前序序列描述一棵树：先写根，再写左子树，最后写右子树；遇到 # 表示这里没有节点，直接返回。按这个规则递归读取，就能唯一还原整棵树。",
      items: [
        "建树和遍历都只沿着树走一遍，不会重复处理同一个节点。",
        "四个遍历操作共用同一棵建好的树，区别只在“什么时候访问根节点”。",
        "动画里灰色是未访问，琥珀色是当前节点，蓝色是已经访问过的节点。",
      ],
    },
    {
      title: "先认识几个词",
      icon: Network,
      body: "读代码前先分清五个词，后面的遍历顺序就不容易绕晕：",
      items: [
        "根节点：整棵树最上面的节点，本演示的默认根是 1。",
        "左孩子 / 右孩子：节点向下连接的两个子节点；没有孩子时对应位置就是空。",
        "叶子：没有孩子的节点，默认树里是 4、5、6、7。",
        "树高：从根到最远叶子的层数，默认树高为 3（根算第 1 层）。",
        "空子树：用 # 表示，它不是节点，只是告诉递归“这一边到底了”。",
      ],
    },
    {
      title: "前序建树怎么读",
      icon: ScanLine,
      body: "默认输入是 1, 2, 4, #, #, 5, #, #, 3, 6, #, #, 7, #, #。按“根、左、右”的递归规则读：",
      items: [
        "读到 1，创建根；接着读它的左子树。",
        "读到 2，作为 1 的左孩子；再读 2 的左子树，得到 4。",
        "4 后面两个 # 表示 4 没有左、右孩子，回到 2；再读 2 的右子树，得到 5。",
        "5 的两个 # 结束后回到 1，开始读右子树；读到 3，再依次读到 6 和 7。",
        "口诀：读到值就建节点，读到 # 就返回上一层；左右子树的顺序不能反。",
      ],
    },
    {
      title: "四种遍历怎么记",
      icon: Network,
      body: "四种遍历的区别只有“访问根节点的时机”，左右子树永远先左后右。默认树的结果如下：",
      items: [
        "前序（根 → 左 → 右）：1, 2, 4, 5, 3, 6, 7。进入节点就访问。",
        "中序（左 → 根 → 右）：4, 2, 5, 1, 6, 3, 7。左子树返回后再访问根。",
        "后序（左 → 右 → 根）：4, 5, 2, 6, 7, 3, 1。左右子树都返回后才访问根。",
        "层序（逐层从左到右）：1, 2, 3, 4, 5, 6, 7。用队列实现，根先入队，出队时把左孩子、右孩子依次入队。",
      ],
    },
    {
      title: "复杂度",
      icon: Gauge,
      body: "设节点数为 n、树高为 h。建树时每个节点值只读一次，空位 # 也只会让递归立即返回，所以总共处理约 2n + 1 个记号，也就是 O(n)。三种递归遍历中，每个节点恰好进入一次访问逻辑，相当于循环 n 次，因此也是 O(n)。层序遍历中，每个节点入队、出队各一次，同样是 O(n)。",
      rows: [
        { label: "建树（读取 2n + 1 个记号）", value: "O(n)" },
        { label: "前序 / 中序 / 后序（n 次访问）", value: "O(n)" },
        { label: "层序遍历（n 次入队、n 次出队）", value: "O(n)" },
        { label: "递归调用栈", value: "O(h)，最坏 O(n)" },
        { label: "层序队列", value: "O(树宽)，最坏 O(n)" },
      ],
    },
    {
      title: "易错点",
      icon: TriangleAlert,
      body: "前序序列里的 # 不是可选项：它决定空子树的位置，漏写会让后面的节点接错父节点。",
      items: [
        "# 的数量要完整：n 个节点的二叉树有 n + 1 个空孩子，所以前序序列共 2n + 1 个记号。",
        "递归函数必须先判断空节点并返回，否则会继续读取越界。",
        "前序、中序、后序的差别是访问根的时机，不是左右子树的顺序；左右子树始终先左后右。",
        "层序遍历入队时也要先左后右，否则同一层的输出顺序会反。",
        "演示最多 15 个节点、31 个记号，这是展示上限，不是算法本身的限制。",
      ],
    },
  ],
  trace: ({ values, operation }: TraceInput) =>
    binaryTreeTrace(values, operation),
  code: (language, operation) =>
    parseCode(templates[language][operation] ?? templates[language].preorder),
};
