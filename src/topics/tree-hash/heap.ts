import {
  BookOpen,
  Gauge,
  ScanLine,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { parseCode } from "../../core/code";
import type { Frame, FrameLink, TraceInput } from "../../core/types";
import type { ReadyTopic } from "../types";
import { templates } from "./heap-templates";

export const MAX_NODES = 15;
export const DEFAULT_VALUES = [50, 30, 70, 20, 40, 60, 80];
const DEFAULT_INPUT = "50, 30, 70, 20, 40, 60, 80";
const EMPTY_MESSAGE = "请输入键序列，例如 `50, 30, 70, 20, 40, 60, 80`。";
const INVALID_MESSAGE = `请输入最多 ${MAX_NODES} 个整数，范围 -999 到 999。`;
const INSERT_VALUE_MESSAGE = "插入值须为 -999 到 999 的整数。";
const FULL_MESSAGE = `最多展示 ${MAX_NODES} 个节点，无法继续插入。`;
const OPERATIONS = ["create", "insert", "extract"] as const;
type HeapOperation = (typeof OPERATIONS)[number];

interface HeapNode {
  id: number;
  value: number;
}

function validateValues(values: number[], limit = MAX_NODES) {
  if (!values.length) throw new Error(EMPTY_MESSAGE);
  if (values.length > limit)
    throw new Error(`最多展示 ${limit} 个节点，请减小输入规模。`);
  for (const value of values)
    if (!Number.isInteger(value) || Math.abs(value) > 999)
      throw new Error(INVALID_MESSAGE);
}

export function parseHeapInput(text: string, limit = MAX_NODES): number[] {
  const tokens = text
    .trim()
    .split(/[,，\s]+/)
    .filter(Boolean);
  if (!tokens.length) throw new Error(EMPTY_MESSAGE);
  if (tokens.length > limit)
    throw new Error(`最多展示 ${limit} 个节点，请减小输入规模。`);
  if (tokens.some((token) => !/^-?\d+$/.test(token)))
    throw new Error(INVALID_MESSAGE);
  const values = tokens.map(Number);
  validateValues(values, limit);
  return values;
}

/** 数组下标 i 的父节点下标；根节点没有父节点。 */
export function parentIndex(index: number) {
  return Math.floor((index - 1) / 2);
}

function linksOf(heap: HeapNode[]): FrameLink[] {
  const links: FrameLink[] = [];
  for (let index = 1; index < heap.length; index++)
    links.push([
      heap[parentIndex(index)].id,
      heap[index].id,
      index % 2 === 1 ? "left" : "right",
    ]);
  return links;
}

function snapshot(
  heap: HeapNode[],
  {
    anchor,
    narration,
    active = [],
    settled = [],
    index,
  }: {
    anchor: string;
    narration: string;
    active?: number[];
    settled?: number[];
    /** 当前调整到的数组下标。 */
    index?: number;
  },
): Frame {
  // items 按 id 升序，active / settled 用 items 下标；heapOrder 与连线用节点 id。
  const items = [...heap].sort((a, b) => a.id - b.id);
  const indexOf = new Map(items.map((node, position) => [node.id, position]));
  const toIndices = (ids: number[]) => [
    ...new Set(
      ids
        .map((id) => indexOf.get(id) ?? -1)
        .filter((position) => position >= 0),
    ),
  ];
  return {
    items: items.map(({ id, value }) => ({ id, value })),
    active: toIndices(active),
    settled: toIndices(settled),
    pointers: {},
    anchor,
    narration,
    variables: {
      size: heap.length,
      ...(index === undefined ? {} : { index }),
    },
    stack: [],
    queue: [],
    links: linksOf(heap),
    heapOrder: heap.map((node) => node.id),
    rootId: heap[0]?.id ?? null,
  };
}

/** 把值追加到数组末尾；调用方已经检查过容量。 */
function appendNode(heap: HeapNode[], id: number, value: number): HeapNode {
  const node: HeapNode = { id, value };
  heap.push(node);
  return node;
}

/**
 * 从末尾节点开始上浮，逐帧记录比较与交换。
 * settled 保存已经比较过、被留在下方的父节点。
 */
function siftUpFrames(heap: HeapNode[], frames: Frame[], start: number) {
  let index = start;
  const movingId = heap[index].id;
  const settled: number[] = [];
  while (index > 0) {
    const parent = parentIndex(index);
    const current = heap[index];
    const above = heap[parent];
    const needSwap = current.value < above.value;
    frames.push(
      snapshot(heap, {
        anchor: "compare",
        narration: `比较 ${current.value} 与父节点 ${above.value}：${
          current.value
        } ${needSwap ? "<" : ">="} ${above.value}，${
          needSwap ? "需要上浮。" : "堆序满足，停止上浮。"
        }`,
        active: [movingId],
        settled,
        index,
      }),
    );
    if (!needSwap) break;
    heap[parent] = current;
    heap[index] = above;
    settled.push(above.id);
    frames.push(
      snapshot(heap, {
        anchor: "swap",
        narration: `交换 ${current.value} 与 ${above.value}，${current.value} 上浮到下标 ${parent}。`,
        active: [movingId],
        settled,
        index: parent,
      }),
    );
    index = parent;
  }
}

function appendSuffix(frames: Frame[], suffix: string) {
  const last = frames.at(-1);
  if (last) last.narration += suffix;
}

function createFrames(values: number[]): Frame[] {
  const heap: HeapNode[] = [];
  const frames: Frame[] = [];
  values.forEach((value, id) => {
    const node = appendNode(heap, id, value);
    frames.push(
      snapshot(heap, {
        anchor: "append",
        narration: `把 ${value} 放到数组下标 ${heap.length - 1}。`,
        active: [node.id],
        index: heap.length - 1,
      }),
    );
    siftUpFrames(heap, frames, heap.length - 1);
  });
  appendSuffix(frames, `建堆完成，共 ${heap.length} 个节点。`);
  return frames;
}

function buildHeap(values: number[]): HeapNode[] {
  const heap: HeapNode[] = [];
  values.forEach((value, id) => {
    appendNode(heap, id, value);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = parentIndex(index);
      if (heap[parent].value <= heap[index].value) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  });
  return heap;
}

function insertFrames(values: number[], target: number): Frame[] {
  const heap = buildHeap(values);
  if (heap.length >= MAX_NODES) throw new Error(FULL_MESSAGE);
  const frames: Frame[] = [
    snapshot(heap, {
      anchor: "start",
      narration: `准备插入 ${target}：把 ${target} 追加到数组末尾。`,
    }),
  ];
  const node = appendNode(heap, values.length, target);
  frames.push(
    snapshot(heap, {
      anchor: "append",
      narration: `把 ${target} 放到数组下标 ${heap.length - 1}。`,
      active: [node.id],
      index: heap.length - 1,
    }),
  );
  siftUpFrames(heap, frames, heap.length - 1);
  appendSuffix(frames, `插入完成，共 ${heap.length} 个节点。`);
  return frames;
}

function extractFrames(values: number[]): Frame[] {
  const heap = buildHeap(values);
  const frames: Frame[] = [];
  const minimum = heap[0];
  const last = heap[heap.length - 1];
  frames.push(
    snapshot(heap, {
      anchor: "start",
      narration: `准备删除堆顶：记录堆顶 ${minimum.value}，把末元素 ${last.value} 移到堆顶。`,
    }),
  );

  if (heap.length === 1) {
    heap.length = 0;
    frames.push(
      snapshot(heap, {
        anchor: "replace",
        narration: `删除堆顶 ${minimum.value}，堆变空。删除完成，堆为空。`,
      }),
    );
    return frames;
  }

  heap.pop();
  heap[0] = last;
  frames.push(
    snapshot(heap, {
      anchor: "replace",
      narration: `把末元素 ${last.value} 移到堆顶，堆大小变为 ${heap.length}。`,
      active: [last.id],
      index: 0,
    }),
  );

  let index = 0;
  const settled: number[] = [];
  while (true) {
    const left = 2 * index + 1;
    if (left >= heap.length) break;
    let childIndex = left;
    if (
      left + 1 < heap.length &&
      heap[left + 1].value < heap[left].value
    )
      childIndex = left + 1;
    const current = heap[index];
    const child = heap[childIndex];
    const needSwap = current.value > child.value;
    frames.push(
      snapshot(heap, {
        anchor: "compare",
        narration: `比较 ${current.value} 与较小孩子 ${child.value}：${
          current.value
        } ${needSwap ? ">" : "<="} ${child.value}，${
          needSwap ? "需要下沉。" : "堆序满足，停止下沉。"
        }`,
        active: [current.id],
        settled,
        index,
      }),
    );
    if (!needSwap) break;
    heap[index] = child;
    heap[childIndex] = current;
    settled.push(child.id);
    frames.push(
      snapshot(heap, {
        anchor: "swap",
        narration: `交换 ${current.value} 与 ${child.value}，${current.value} 下沉到下标 ${childIndex}。`,
        active: [current.id],
        settled,
        index: childIndex,
      }),
    );
    index = childIndex;
  }

  const top = heap[0];
  appendSuffix(
    frames,
    top ? `删除完成，当前堆顶为 ${top.value}。` : "删除完成，堆为空。",
  );
  return frames;
}

export function heapTrace(
  values: number[],
  operation: string,
  value = 0,
): Frame[] {
  validateValues(values);
  if (!OPERATIONS.includes(operation as HeapOperation))
    throw new Error("未知操作。");
  if (
    operation === "insert" &&
    (!Number.isInteger(value) || Math.abs(value) > 999)
  )
    throw new Error(INSERT_VALUE_MESSAGE);

  if (operation === "create") return createFrames(values);
  if (operation === "insert") return insertFrames(values, value);
  return extractFrames(values);
}

export const heap: ReadyTopic = {
  id: "heap",
  group: "tree-hash",
  title: "二叉堆",
  badge: "O(log n)",
  summary: "完全二叉树的上浮与下沉，是优先队列的实现基础。",
  status: "ready",
  scene: "heap",
  icon: Workflow,
  controls: {
    dataLabel: "键序列",
    defaultValues: DEFAULT_VALUES,
    defaultInput: DEFAULT_INPUT,
    parseInput: parseHeapInput,
    limit: MAX_NODES,
    defaultOperation: "insert",
    randomizable: false,
    operations: [
      { id: "create", label: "创建" },
      { id: "insert", label: "插入" },
      { id: "extract", label: "删除堆顶" },
    ],
    value: {
      label: "插入值",
      onlyFor: ["insert"],
      defaultValue: 15,
    },
  },
  legend: [
    { label: "当前节点 / 当前下标", tone: "pivot" },
    { label: "已比较", tone: "active" },
    { label: "未访问", tone: "idle" },
  ],
  theory: [
    {
      title: "核心思路",
      icon: BookOpen,
      body: "小顶堆是一种特殊的完全二叉树：每个父节点都不大于它的孩子，所以整个堆的最小值一定在根，也就是数组下标 0。它只保证“堆顶最小”，并不保证整个数组有序。插入新元素用上浮，删除堆顶用下沉。",
      items: [
        "完全二叉树可以按层序直接放进数组，不需要指针。",
        "插入时先把新值放到数组末尾，再向上调整，叫上浮。",
        "删除堆顶时把末尾元素移到根，再向下调整，叫下沉。",
      ],
    },
    {
      title: "先认识几个词",
      icon: Workflow,
      body: "先分清六个词，再看动画就不会迷路：",
      items: [
        "完全二叉树：除了最后一层，其他层都排满，最后一层从左到右连续排列。",
        "堆序：小顶堆中，父节点的值不大于左右孩子。",
        "堆顶：数组下标 0 的元素，也就是整棵树的最小值。",
        "树高：从根到最远叶子的层数；默认数据有 7 个节点，树高为 3。",
        "上浮：新元素从下往上和父节点比较、交换。",
        "下沉：元素从上往下和较小的孩子比较、交换。",
      ],
    },
    {
      title: "树与数组怎样对应",
      icon: Workflow,
      body: "数组从下标 0 开始，父子关系可以直接算出来：",
      items: [
        "下标 i 的父节点是 (i - 1) / 2，结果向下取整。",
        "下标 i 的左孩子是 2i + 1，右孩子是 2i + 2。",
        "默认数据中，20 在下标 3，父节点是下标 1 的 30；60 在下标 5，父节点是下标 2 的 70。",
        "完全二叉树的节点按层序紧密排列，所以数组中间不会出现空洞。",
      ],
    },
    {
      title: "一次插入与一次删除怎么走",
      icon: ScanLine,
      body: "用默认数据 50, 30, 70, 20, 40, 60, 80 走一遍，插入和删除都只改一条路径：",
      items: [
        "插入 15：先放到末尾下标 7；父节点是 20，15 < 20，交换。",
        "到下标 3 后父节点是 30，15 < 30，继续交换；到下标 1 后父节点是 50，15 < 50，再交换，15 到达根，停止。",
        "删除堆顶：记录 50，把末尾的 80 移到根，堆大小从 7 变成 6。",
        "80 的两个孩子中较小的是 30，80 > 30，交换；到下标 1 后较小孩子是 20，80 > 20，再交换；80 到叶子后停止，新堆顶是 30。",
      ],
    },
    {
      title: "复杂度",
      icon: Gauge,
      body: "设堆中有 n 个元素、树高为 h。查看堆顶只读 heap[0]，O(1)。插入先追加到末尾 O(1)，再上浮最多 h 层，每层一次比较和常数次交换，所以 O(log n)。删除把末元素移到根 O(1)，再下沉最多 h 层，也是 O(log n)。创建时第 i 次插入最多上浮 log₂ i 层，累计约 n log n，所以本演示的逐个插入建堆是 O(n log n)；自底向上建堆可以做到 O(n)，但当前演示没有使用。",
      rows: [
        { label: "查看堆顶", value: "O(1)" },
        { label: "插入（上浮）", value: "O(log n)" },
        { label: "删除堆顶（下沉）", value: "O(log n)" },
        { label: "建堆（逐个插入）", value: "O(n log n)" },
        { label: "额外空间", value: "O(n)" },
      ],
    },
    {
      title: "易错点",
      icon: TriangleAlert,
      body: "堆的代码不长，但下标和比较对象很容易写错。",
      items: [
        "本演示使用 0 基下标；如果按 1 基写，父子公式会变成 i / 2、2i、2i + 1，两套公式不能混用。",
        "下沉时要和较小的孩子交换。只和左孩子比较，可能漏掉右孩子更小的情况。",
        "当前节点不大于较小的孩子时就应停止；相等也停止，继续交换没有意义。",
        "删除堆顶前先处理空堆；只有一个元素时直接删掉，不需要下沉。",
        "堆只保证根是最小值，数组中其余元素并不按升序排列。",
      ],
    },
  ],
  trace: ({ values, operation, value }: TraceInput) =>
    heapTrace(values, operation, value),
  code: (language, operation) =>
    parseCode(
      templates[language][operation] ?? templates[language].insert,
    ),
};
