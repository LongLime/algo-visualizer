import {
  BookOpen,
  Gauge,
  GitFork,
  ScanLine,
  Split,
  TriangleAlert,
} from "lucide-react";
import { parseCode } from "../../core/code";
import type { Frame, FrameLink, TraceInput } from "../../core/types";
import type { ReadyTopic } from "../types";
import { templates } from "./union-find-templates";

export const MAX_ELEMENTS = 15;
export const DEFAULT_VALUES = [0, 1, 2, 3, 4, 5, 6, 7];
const DEFAULT_INPUT = "{0,1,2,3}, {4,5}, {6,7}";
const EMPTY_MESSAGE = "请输入集合，例如 `{0,1,2}, {3,4}`。";
const BRACES_MESSAGE = "请用 `{}` 划分集合，例如 `{0,1,2}, {3,4}`。";
const INVALID_MESSAGE = `请输入最多 ${MAX_ELEMENTS} 个整数，范围 -999 到 999。`;
const LIMIT_MESSAGE = `最多展示 ${MAX_ELEMENTS} 个元素，请减小输入规模。`;
const OPERATIONS = ["create", "find", "union", "connected"] as const;
type UnionOperation = (typeof OPERATIONS)[number];

interface UnionState {
  items: { id: number; value: number }[];
  parent: number[];
  rank: number[];
  idByValue: Map<number, number>;
}

function validateGroups(groups: number[][], limit = MAX_ELEMENTS) {
  const flat = groups.flat();
  if (flat.length > limit) throw new Error(LIMIT_MESSAGE);
  const seen = new Set<number>();
  for (const value of flat) {
    if (!Number.isInteger(value) || Math.abs(value) > 999)
      throw new Error(INVALID_MESSAGE);
    if (seen.has(value))
      throw new Error(
        `元素 ${value} 重复出现，集合之间不能重叠。`,
      );
    seen.add(value);
  }
}

function parseGroups(text: string, limit = MAX_ELEMENTS): number[][] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(EMPTY_MESSAGE);
  if (!trimmed.includes("{")) throw new Error(BRACES_MESSAGE);
  const groups: number[][] = [];
  let cursor = 0;
  const skipSeparators = () => {
    while (
      cursor < trimmed.length &&
      /[\s,，]/.test(trimmed[cursor])
    )
      cursor += 1;
  };
  skipSeparators();
  while (cursor < trimmed.length) {
    if (trimmed[cursor] !== "{") throw new Error(BRACES_MESSAGE);
    const close = trimmed.indexOf("}", cursor + 1);
    if (close < 0) throw new Error(BRACES_MESSAGE);
    const body = trimmed.slice(cursor + 1, close).trim();
    if (!body) throw new Error("集合不能为空。");
    const tokens = body.split(/[,，\s]+/).filter(Boolean);
    if (tokens.some((token) => !/^-?\d+$/.test(token)))
      throw new Error(INVALID_MESSAGE);
    groups.push(tokens.map(Number));
    cursor = close + 1;
    skipSeparators();
    if (cursor < trimmed.length && trimmed[cursor] !== "{")
      throw new Error(BRACES_MESSAGE);
  }
  if (!groups.length) throw new Error(EMPTY_MESSAGE);
  validateGroups(groups, limit);
  return groups;
}

/** 用 `NaN` 哨兵分隔集合，返回可以直接放进 `TraceInput.values` 的数组。 */
export function parseUnionFindInput(
  text: string,
  limit = MAX_ELEMENTS,
): number[] {
  const groups = parseGroups(text, limit);
  return groups.flatMap((group, index) =>
    index < groups.length - 1 ? [...group, NaN] : group,
  );
}

/** 从 `values` 还原集合；没有 `NaN` 时整段视为一个集合。 */
export function unionFindGroups(
  values: number[],
  limit = MAX_ELEMENTS,
): number[][] {
  if (!values.length) throw new Error(EMPTY_MESSAGE);
  const groups: number[][] = [];
  let current: number[] = [];
  for (const value of values) {
    if (Number.isNaN(value)) {
      if (!current.length) throw new Error("集合不能为空。");
      groups.push(current);
      current = [];
    } else current.push(value);
  }
  if (!current.length) throw new Error("集合不能为空。");
  groups.push(current);
  validateGroups(groups, limit);
  return groups;
}

function makeState(groups: number[][]): UnionState {
  const items = groups
    .flat()
    .map((value, id) => ({ id, value }));
  const idByValue = new Map(
    items.map((item) => [item.value, item.id] as const),
  );
  return {
    items,
    parent: items.map((item) => item.id),
    rank: items.map(() => 0),
    idByValue,
  };
}

function valueOf(state: UnionState, id: number) {
  return state.items[id]?.value ?? id;
}

function snapshot(
  state: UnionState,
  {
    anchor,
    narration,
    active = [],
    settled = [],
  }: {
    anchor: string;
    narration: string;
    active?: number[];
    settled?: number[];
  },
): Frame {
  const indexOf = new Map(
    state.items.map((item, index) => [item.id, index] as const),
  );
  const toIndices = (ids: number[]) => [
    ...new Set(
      ids
        .map((id) => indexOf.get(id) ?? -1)
        .filter((index) => index >= 0),
    ),
  ];
  const links: FrameLink[] = state.parent.flatMap((parent, id) =>
    parent === id ? [] : [[id, parent] as FrameLink],
  );
  return {
    items: state.items.map(({ id, value }) => ({ id, value })),
    active: toIndices(active),
    settled: toIndices(settled),
    pointers: {},
    anchor,
    narration,
    variables: {
      size: state.items.length,
      sets: state.parent.filter((parent, id) => parent === id).length,
    },
    stack: [],
    queue: [],
    links,
    unionParents: [...state.parent],
    unionRanks: [...state.rank],
  };
}

/** 沿父指针上溯，返回不含根的路径。 */
function pathToRoot(state: UnionState, id: number) {
  const path: number[] = [];
  let node = id;
  while (state.parent[node] !== node) {
    path.push(node);
    node = state.parent[node];
  }
  return { path, root: node };
}

function appendSuffix(frames: Frame[], suffix: string) {
  const last = frames.at(-1);
  if (last) last.narration += suffix;
}

/**
 * 查找并记录访问与压缩帧。
 * 根节点直接发 root 帧；已经直接指向根的路径节点不再重复发压缩帧。
 */
function findFrames(
  state: UnionState,
  id: number,
  frames: Frame[],
) {
  const { path, root } = pathToRoot(state, id);
  const visited: number[] = [];
  for (const node of path) {
    const parent = state.parent[node];
    frames.push(
      snapshot(state, {
        anchor: "visit",
        narration: `元素 ${valueOf(state, node)} 的父节点是 ${valueOf(
          state,
          parent,
        )}，继续上溯。`,
        active: [node],
        settled: visited,
      }),
    );
    visited.push(node);
  }
  const route = [...path, root]
    .map((node) => valueOf(state, node))
    .join(" → ");
  frames.push(
    snapshot(state, {
      anchor: "root",
      narration: path.length
        ? `找到根 ${valueOf(state, root)}，路径为 ${route}。`
        : `元素 ${valueOf(state, id)} 本身是根。`,
      active: [root],
      settled: visited,
    }),
  );
  for (const node of path) {
    if (state.parent[node] === root) continue;
    const before = state.parent[node];
    state.parent[node] = root;
    frames.push(
      snapshot(state, {
        anchor: "compress",
        narration: `路径压缩：parent[${valueOf(
          state,
          node,
        )}] 由 ${valueOf(state, before)} 改为 ${valueOf(state, root)}。`,
        active: [node],
        settled: [...visited, root],
      }),
    );
  }
  return { root, path };
}

/** 查找两个根、比较 rank 并挂接；同根时不修改结构。 */
function uniteFrames(
  state: UnionState,
  a: number,
  b: number,
  frames: Frame[],
) {
  const sideA = findFrames(state, a, frames);
  const sideB = findFrames(state, b, frames);
  const rootA = sideA.root;
  const rootB = sideB.root;
  const pathSettled = [...sideA.path, ...sideB.path];
  if (rootA === rootB) {
    frames.push(
      snapshot(state, {
        anchor: "compare",
        narration: `两个元素的根都是 ${valueOf(
          state,
          rootA,
        )}，已在同一集合，无需合并。`,
        active: [rootA],
        settled: pathSettled,
      }),
    );
    return { root: rootA, linked: false };
  }
  const rankA = state.rank[rootA];
  const rankB = state.rank[rootB];
  const equal = rankA === rankB;
  const newRoot = rankA < rankB ? rootB : rootA;
  const attached = rankA < rankB ? rootA : rootB;
  const comparison =
    rankA === rankB
      ? `比较根 ${valueOf(state, rootA)} 与根 ${valueOf(
          state,
          rootB,
        )}：rank 都是 ${rankA}，把 ${valueOf(
          state,
          rootB,
        )} 挂到 ${valueOf(state, rootA)} 下，rank[${valueOf(
          state,
          rootA,
        )}] 加一。`
      : rankA < rankB
        ? `比较根 ${valueOf(state, rootA)}（rank ${rankA}）与根 ${valueOf(
            state,
            rootB,
          )}（rank ${rankB}）：${valueOf(
            state,
            rootA,
          )} 更矮，把 ${valueOf(state, rootA)} 挂到 ${valueOf(
            state,
            rootB,
          )} 下。`
        : `比较根 ${valueOf(state, rootA)}（rank ${rankA}）与根 ${valueOf(
            state,
            rootB,
          )}（rank ${rankB}）：${valueOf(
            state,
            rootB,
          )} 更矮，把 ${valueOf(state, rootB)} 挂到 ${valueOf(
            state,
            rootA,
          )} 下。`;
  frames.push(
    snapshot(state, {
      anchor: "compare",
      narration: comparison,
      active: [rootA, rootB],
      settled: pathSettled,
    }),
  );
  state.parent[attached] = newRoot;
  if (equal) state.rank[newRoot] += 1;
  frames.push(
    snapshot(state, {
      anchor: "link",
      narration: `把根 ${valueOf(state, attached)} 挂到根 ${valueOf(
        state,
        newRoot,
      )} 下，rank[${valueOf(state, newRoot)}] = ${
        state.rank[newRoot]
      }。`,
      active: [newRoot],
      settled: [attached, ...pathSettled],
    }),
  );
  return { root: newRoot, linked: true };
}

/** 创建时静默合并两个根，不产生帧。 */
function mergeSilently(state: UnionState, a: number, b: number) {
  if (a === b) return a;
  const rankA = state.rank[a];
  const rankB = state.rank[b];
  const root = rankA < rankB ? b : a;
  const attached = rankA < rankB ? a : b;
  state.parent[attached] = root;
  if (rankA === rankB) state.rank[root] += 1;
  return root;
}

function buildGroupSilently(
  state: UnionState,
  group: number[],
): number {
  if (group.length === 1) return group[0];
  const mid = Math.floor(group.length / 2);
  const a = buildGroupSilently(state, group.slice(0, mid));
  const b = buildGroupSilently(state, group.slice(mid));
  return mergeSilently(state, a, b);
}

function initialState(groups: number[][]) {
  const state = makeState(groups);
  for (const group of groups) {
    const ids = group.map((value) => state.idByValue.get(value)!);
    buildGroupSilently(state, ids);
  }
  return state;
}

function buildGroupWithFrames(
  state: UnionState,
  group: number[],
  frames: Frame[],
): number {
  if (group.length === 1) return group[0];
  const mid = Math.floor(group.length / 2);
  const a = buildGroupWithFrames(state, group.slice(0, mid), frames);
  const b = buildGroupWithFrames(state, group.slice(mid), frames);
  return uniteFrames(state, a, b, frames).root;
}

function createFrames(groups: number[][]) {
  const state = makeState(groups);
  const frames: Frame[] = [
    snapshot(state, {
      anchor: "init",
      narration: `初始化：${state.items.length} 个元素各自成为一个集合。`,
    }),
  ];
  for (const group of groups) {
    const ids = group.map((value) => state.idByValue.get(value)!);
    buildGroupWithFrames(state, ids, frames);
  }
  appendSuffix(
    frames,
    `创建完成：共 ${state.items.length} 个元素、${state.parent.filter(
      (parent, id) => parent === id,
    ).length} 个集合。`,
  );
  return frames;
}

function lookup(
  state: UnionState,
  value: number,
  label: string,
) {
  if (!Number.isInteger(value) || Math.abs(value) > 999)
    throw new Error(`${label} 须为 -999 到 999 的整数。`);
  const id = state.idByValue.get(value);
  if (id === undefined)
    throw new Error(`${label} ${value} 不在集合中。`);
  return id;
}

function findOperation(state: UnionState, id: number) {
  const frames: Frame[] = [
    snapshot(state, {
      anchor: "start",
      narration: `准备查找 ${valueOf(
        state,
        id,
      )}：从该元素开始沿父指针上溯。`,
      active: [id],
    }),
  ];
  const { root } = findFrames(state, id, frames);
  appendSuffix(
    frames,
    `查找完成：${valueOf(state, id)} 的根是 ${valueOf(state, root)}。`,
  );
  return frames;
}

function unionOperation(state: UnionState, a: number, b: number) {
  const frames: Frame[] = [
    snapshot(state, {
      anchor: "start",
      narration: `准备合并 ${valueOf(state, a)} 与 ${valueOf(
        state,
        b,
      )}：先查找两个根。`,
      active: [a, b],
    }),
  ];
  const { root, linked } = uniteFrames(state, a, b, frames);
  appendSuffix(
    frames,
    linked
      ? `合并完成：${valueOf(state, a)} 与 ${valueOf(
          state,
          b,
        )} 连通，根为 ${valueOf(state, root)}。`
      : `合并完成：${valueOf(state, a)} 与 ${valueOf(
          state,
          b,
        )} 已连通，根为 ${valueOf(state, root)}。`,
  );
  return frames;
}

function connectedOperation(state: UnionState, a: number, b: number) {
  const frames: Frame[] = [
    snapshot(state, {
      anchor: "start",
      narration: `准备判断 ${valueOf(state, a)} 与 ${valueOf(
        state,
        b,
      )} 是否连通：分别查找根。`,
      active: [a, b],
    }),
  ];
  const sideA = findFrames(state, a, frames);
  const sideB = findFrames(state, b, frames);
  const connected = sideA.root === sideB.root;
  frames.push(
    snapshot(state, {
      anchor: "answer",
      narration: `${valueOf(state, a)} 的根是 ${valueOf(
        state,
        sideA.root,
      )}，${valueOf(state, b)} 的根是 ${valueOf(
        state,
        sideB.root,
      )}：${connected ? "连通" : "不连通"}。`,
      active: [sideA.root, sideB.root],
      settled: [...sideA.path, ...sideB.path],
    }),
  );
  appendSuffix(
    frames,
    `连通性判断完成：${valueOf(state, a)} 与 ${valueOf(state, b)} ${
      connected ? "连通" : "不连通"
    }。`,
  );
  return frames;
}

export function unionFindTrace(
  values: number[],
  operation: string,
  value = 0,
  value2 = 0,
): Frame[] {
  const groups = unionFindGroups(values);
  if (!OPERATIONS.includes(operation as UnionOperation))
    throw new Error("未知操作。");
  if (operation === "create") return createFrames(groups);
  const state = initialState(groups);
  if (operation === "find") {
    const id = lookup(state, value, "查找元素");
    return findOperation(state, id);
  }
  const a = lookup(state, value, "元素 a");
  const b = lookup(state, value2, "元素 b");
  return operation === "union"
    ? unionOperation(state, a, b)
    : connectedOperation(state, a, b);
}

export const unionFind: ReadyTopic = {
  id: "union-find",
  group: "tree-hash",
  title: "并查集",
  badge: "近 O(1)",
  summary: "按秩合并与路径压缩，快速判断集合连通性。",
  status: "ready",
  scene: "union-find",
  icon: GitFork,
  controls: {
    dataLabel: "集合",
    defaultValues: DEFAULT_VALUES,
    defaultInput: DEFAULT_INPUT,
    parseInput: parseUnionFindInput,
    limit: MAX_ELEMENTS,
    defaultOperation: "find",
    randomizable: false,
    operations: [
      { id: "create", label: "创建" },
      { id: "find", label: "查找" },
      { id: "union", label: "合并" },
      { id: "connected", label: "连通" },
    ],
    value: {
      label: "元素 a",
      onlyFor: ["find", "union", "connected"],
      defaultValue: 3,
    },
    value2: {
      label: "元素 b",
      onlyFor: ["union", "connected"],
      defaultValue: 7,
    },
  },
  legend: [
    { label: "当前元素", tone: "pivot" },
    { label: "路径已访问", tone: "active" },
    { label: "根节点", tone: "settled" },
    { label: "未访问", tone: "idle" },
  ],
  theory: [
    {
      title: "核心思路",
      icon: BookOpen,
      body: "并查集要解决的是“两个元素在不在同一个集合”以及“把两个集合合起来”。它不保存每个集合的完整成员，而是给每个元素只存一个 parent 指针：沿着 parent 一路向上走到根，根就代表整个集合。查找就是找根，合并就是让一个根指向另一个根。",
      items: [
        "parent[x] = x 表示 x 是根；根是集合的代表元。",
        "find(x) 从 x 出发沿 parent 上溯，返回根。",
        "union(a, b) 先找两个根；根相同说明已经连通，根不同才把一棵树挂到另一棵树下。",
        "并查集只关心“连通不连通”，不保存集合里元素的顺序。",
      ],
    },
    {
      title: "先认识几个词",
      icon: GitFork,
      body: "先分清六个词，看动画时就能对上号：",
      items: [
        "父指针 parent：每个元素只记录“我的上一层是谁”。",
        "根：parent[x] = x 的元素，代表整个集合。",
        "路径：从某个元素一路向上到根经过的节点。",
        "rank：每棵树的高度上界，用来决定合并方向。",
        "路径压缩：查找结束后，把路径上的节点直接挂到根上。",
        "按秩合并：把 rank 小的根挂到 rank 大的根下，避免树越接越高。",
      ],
    },
    {
      title: "一次查找怎么走",
      icon: ScanLine,
      body: "以默认输入和查找元素 3 为例。默认父数组是 parent = [0, 0, 0, 2, 4, 4, 6, 6]，所以 3 的路径是 3 → 2 → 0：",
      items: [
        "从 3 开始，parent[3] = 2，向上到 2。",
        "parent[2] = 0，继续向上到 0；parent[0] = 0，0 就是根。",
        "路径压缩：把 3 的 parent 直接改成 0，数组里 parent[3] 从 2 变成 0。",
        "压缩后，树仍表示同一个集合，但下次再查 3 只需要一步。",
      ],
    },
    {
      title: "合并怎么走",
      icon: Split,
      body: "以默认合并 3 和 7 为例。先分别找根：3 的根是 0，7 的根是 6。两个根不同，需要按 rank 决定谁挂到谁下面：",
      items: [
        "rank[0] = 2，rank[6] = 1；rank[6] 更小，把根 6 挂到根 0 下，parent[6] 改为 0。",
        "rank 不相等时，新根的 rank 不变；只有两个 rank 相等时，才把挂接后的根 rank 加一。",
        "如果两个元素本来同根，union 不改变结构，只报告“已连通”。",
        "合并只改一个父指针，不会动集合里的其他元素。",
      ],
    },
    {
      title: "复杂度",
      icon: Gauge,
      body: "设元素数为 n、树高为 h。find 只沿一条路径向上走，路径长度最多为 h，所以单次 find 是 O(h)。只按秩合并时 h 不超过 log₂ n；再加上路径压缩后，路径会越来越短，单次操作不能简单写成 O(1)，更准确的是均摊 O(α(n))，其中 α(n) 增长极慢，实际可以近似看作常数。union 是两次 find 加一次挂接，connected 是两次 find，所以它们与 find 同阶。初始化要建立 n 个 parent 和 rank，空间 O(n)；创建时组内共做 n - k 次合并（k 是集合数），最坏 O(n log n)。",
      rows: [
        { label: "find（只用父指针）", value: "O(h)，最坏 O(n)" },
        { label: "find（按秩合并 + 路径压缩）", value: "均摊 O(α(n))" },
        { label: "union", value: "两次 find + O(1)" },
        { label: "connected", value: "两次 find" },
        { label: "创建", value: "O(n log n) 最坏" },
        { label: "空间", value: "O(n)" },
      ],
    },
    {
      title: "易错点",
      icon: TriangleAlert,
      body: "并查集代码很短，但根、rank 和压缩的细节很容易写错。",
      items: [
        "根的条件是 parent[x] == x，不是 parent[x] == 0；根可以不是 0，也可以是任意元素值。",
        "路径压缩只改路径上的 parent，不改 rank；压缩后 rank 可能大于真实高度，但仍是树高的上界。",
        "按秩合并的方向不能反：rank 小的根挂到 rank 大的根下；两个 rank 相等时，才让新根的 rank 加一。",
        "union 只改被挂接的那个根的 parent，不要逐个修改集合里的元素。",
        "两个元素已经同根时，union 不产生结构变化，本演示只发比较帧，不发挂接帧。",
        "find 和 connected 也会执行路径压缩，所以即使没有合并，parent 数组也可能发生变化。",
        "元素值不要求从 0 开始：内部会先把元素值映射为节点 id，再用 id 访问 parent 和 rank；不要把元素值直接当下标。",
      ],
    },
  ],
  trace: ({ values, operation, value, value2 }: TraceInput) =>
    unionFindTrace(values, operation, value, value2),
  code: (language, operation) =>
    parseCode(
      templates[language][operation] ?? templates[language].find,
    ),
};
