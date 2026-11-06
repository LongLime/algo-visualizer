import {
  BookOpen,
  Gauge,
  Hash,
  ScanLine,
  Split,
  TriangleAlert,
} from "lucide-react";
import { parseCode } from "../../core/code";
import { HASH_BUCKET_COUNT, hashSlot } from "../../core/hash";
import type { Frame, FrameLink, TraceInput } from "../../core/types";
import type { ReadyTopic } from "../types";
import { templates } from "./hash-table-templates";

export const MAX_KEYS = 15;
export const DEFAULT_VALUES = [50, 23, 15, 36, 44, 8, 60];
const DEFAULT_INPUT = "50, 23, 15, 36, 44, 8, 60";
const EMPTY_MESSAGE = "请输入键序列，例如 `50, 23, 15, 36, 44, 8, 60`。";
const INVALID_MESSAGE = `请输入最多 ${MAX_KEYS} 个整数，范围 -999 到 999。`;
const TARGET_MESSAGE = "目标键须为 -999 到 999 的整数。";
const OPERATIONS = ["create", "search", "insert", "delete"] as const;
type HashOperation = (typeof OPERATIONS)[number];

interface HashNode {
  id: number;
  key: number;
  next: HashNode | null;
}

type HashTable = (HashNode | null)[];

function validateValues(values: number[], limit = MAX_KEYS) {
  if (!values.length) throw new Error(EMPTY_MESSAGE);
  if (values.length > limit)
    throw new Error(`最多展示 ${limit} 个键，请减小输入规模。`);
  const seen = new Set<number>();
  for (const key of values) {
    if (!Number.isInteger(key) || Math.abs(key) > 999)
      throw new Error(INVALID_MESSAGE);
    if (seen.has(key))
      throw new Error(`键序列包含重复键 ${key}，哈希表不接受重复键。`);
    seen.add(key);
  }
}

export function parseHashInput(text: string, limit = MAX_KEYS): number[] {
  const tokens = text
    .trim()
    .split(/[,，\s]+/)
    .filter(Boolean);
  if (!tokens.length) throw new Error(EMPTY_MESSAGE);
  if (tokens.length > limit)
    throw new Error(`最多展示 ${limit} 个键，请减小输入规模。`);
  if (tokens.some((token) => !/^-?\d+$/.test(token)))
    throw new Error(INVALID_MESSAGE);
  const values = tokens.map(Number);
  validateValues(values, limit);
  return values;
}

function makeTable(): HashTable {
  return Array.from({ length: HASH_BUCKET_COUNT }, () => null);
}

/** 尾插法，保证冲突键按插入顺序排列。 */
function appendNode(table: HashTable, bucket: number, node: HashNode) {
  const head = table[bucket];
  if (!head) {
    table[bucket] = node;
    return;
  }
  let current = head;
  while (current.next) current = current.next;
  current.next = node;
}

function buildTable(values: number[]): HashTable {
  const table = makeTable();
  values.forEach((key, id) => {
    appendNode(table, hashSlot(key), { id, key, next: null });
  });
  return table;
}

function chainOf(table: HashTable, bucket: number): HashNode[] {
  const chain: HashNode[] = [];
  for (let node = table[bucket]; node; node = node.next) chain.push(node);
  return chain;
}

/** 当前存活节点，按 id 升序；items 与 active / settled 的下标依赖这个顺序。 */
function collectNodes(table: HashTable): HashNode[] {
  const nodes: HashNode[] = [];
  const seen = new Set<number>();
  for (let bucket = 0; bucket < HASH_BUCKET_COUNT; bucket++)
    for (let node = table[bucket]; node; node = node.next)
      if (!seen.has(node.id)) {
        seen.add(node.id);
        nodes.push(node);
      }
  return nodes.sort((a, b) => a.id - b.id);
}

function linksOf(table: HashTable): FrameLink[] {
  const links: FrameLink[] = [];
  for (let bucket = 0; bucket < HASH_BUCKET_COUNT; bucket++)
    for (let node = table[bucket]; node; node = node.next)
      if (node.next) links.push([node.id, node.next.id]);
  return links;
}

function snapshot(
  table: HashTable,
  {
    anchor,
    narration,
    key,
    bucket,
    active = [],
    settled = [],
    activeBuckets = [],
    compared = 0,
  }: {
    anchor: string;
    narration: string;
    /** 准备帧尚未计算桶号，省略后公式条显示通用形式。 */
    key?: number;
    bucket?: number;
    active?: number[];
    settled?: number[];
    activeBuckets?: number[];
    compared?: number;
  },
): Frame {
  const nodes = collectNodes(table);
  const indexOf = new Map(nodes.map((node, index) => [node.id, index]));
  const toIndices = (ids: number[]) => [
    ...new Set(
      ids
        .map((id) => indexOf.get(id) ?? -1)
        .filter((index) => index >= 0),
    ),
  ];
  return {
    items: nodes.map(({ id, key }) => ({ id, value: key })),
    active: toIndices(active),
    settled: toIndices(settled),
    pointers: {},
    anchor,
    narration,
    variables: {
      ...(key === undefined ? {} : { key }),
      ...(bucket === undefined ? {} : { bucket }),
      compared,
      size: nodes.length,
    },
    stack: [],
    queue: [],
    links: linksOf(table),
    bucketHeads: table.map((node) => node?.id ?? null),
    activeBuckets,
  };
}

function hashLine(key: number, bucket: number) {
  return `h(${key}) = ${key} mod 7 = ${bucket}，定位到 ${bucket} 号桶。`;
}

function createFrames(values: number[]): Frame[] {
  const table = makeTable();
  const frames: Frame[] = [];
  let nextId = 0;
  values.forEach((key, index) => {
    const bucket = hashSlot(key);
    const last = index === values.length - 1;
    frames.push(
      snapshot(table, {
        anchor: "hash",
        narration: `插入 ${key}：${hashLine(key, bucket)}`,
        key,
        bucket,
        activeBuckets: [bucket],
      }),
    );
    const chain = chainOf(table, bucket);
    const compared: number[] = [];
    chain.forEach((node) => {
      frames.push(
        snapshot(table, {
          anchor: "compare",
          narration: `比较 ${key} 与 ${node.key}：不相等，沿链继续。`,
          key,
          bucket,
          active: [node.id],
          settled: compared,
          activeBuckets: [bucket],
          compared: compared.length + 1,
        }),
      );
      compared.push(node.id);
    });
    const node: HashNode = { id: nextId++, key, next: null };
    appendNode(table, bucket, node);
    frames.push(
      snapshot(table, {
        anchor: "insert",
        narration: `在 ${bucket} 号桶链尾插入 ${key}。${
          last ? `建表完成，共 ${values.length} 个键。` : ""
        }`,
        key,
        bucket,
        active: [node.id],
        settled: compared,
        activeBuckets: [bucket],
        compared: compared.length,
      }),
    );
  });
  return frames;
}

function searchFrames(table: HashTable, target: number): Frame[] {
  const bucket = hashSlot(target);
  const frames: Frame[] = [
    snapshot(table, {
      anchor: "start",
      narration: `准备查找 ${target}：先计算桶号。`,
    }),
    snapshot(table, {
      anchor: "hash",
      narration: hashLine(target, bucket),
      key: target,
      bucket,
      activeBuckets: [bucket],
    }),
  ];
  const chain = chainOf(table, bucket);
  if (!chain.length) {
    frames.push(
      snapshot(table, {
        anchor: "miss",
        narration: `${bucket} 号桶为空，未找到 ${target}。`,
        key: target,
        bucket,
        activeBuckets: [bucket],
      }),
    );
    return frames;
  }
  const compared: number[] = [];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i];
    const count = compared.length + 1;
    if (node.key === target) {
      frames.push(
        snapshot(table, {
          anchor: "found",
          narration: `在 ${bucket} 号桶找到 ${target}。`,
          key: target,
          bucket,
          active: [node.id],
          settled: compared,
          activeBuckets: [bucket],
          compared: count,
        }),
      );
      return frames;
    }
    if (i === chain.length - 1) {
      frames.push(
        snapshot(table, {
          anchor: "miss",
          narration: `比较 ${target} 与 ${node.key}：不相等，链结束，未找到 ${target}。`,
          key: target,
          bucket,
          active: [node.id],
          settled: compared,
          activeBuckets: [bucket],
          compared: count,
        }),
      );
      return frames;
    }
    frames.push(
      snapshot(table, {
        anchor: "compare",
        narration: `比较 ${target} 与 ${node.key}：不相等，沿链继续。`,
        key: target,
        bucket,
        active: [node.id],
        settled: compared,
        activeBuckets: [bucket],
        compared: count,
      }),
    );
    compared.push(node.id);
  }
  return frames;
}

function insertFrames(
  table: HashTable,
  target: number,
  nextId: number,
): Frame[] {
  const bucket = hashSlot(target);
  const frames: Frame[] = [
    snapshot(table, {
      anchor: "start",
      narration: `准备插入 ${target}：先计算桶号。`,
    }),
    snapshot(table, {
      anchor: "hash",
      narration: hashLine(target, bucket),
      key: target,
      bucket,
      activeBuckets: [bucket],
    }),
  ];
  const chain = chainOf(table, bucket);
  const compared: number[] = [];
  for (const node of chain) {
    const count = compared.length + 1;
    if (node.key === target) {
      frames.push(
        snapshot(table, {
          anchor: "exists",
          narration: `比较 ${target} 与 ${node.key}：相等，键已存在，不重复插入。`,
          key: target,
          bucket,
          active: [node.id],
          settled: compared,
          activeBuckets: [bucket],
          compared: count,
        }),
      );
      return frames;
    }
    frames.push(
      snapshot(table, {
        anchor: "compare",
        narration: `比较 ${target} 与 ${node.key}：不相等，沿链继续。`,
        key: target,
        bucket,
        active: [node.id],
        settled: compared,
        activeBuckets: [bucket],
        compared: count,
      }),
    );
    compared.push(node.id);
  }
  if (collectNodes(table).length >= MAX_KEYS)
    throw new Error(`最多展示 ${MAX_KEYS} 个键，无法继续插入。`);
  const node: HashNode = { id: nextId, key: target, next: null };
  appendNode(table, bucket, node);
  frames.push(
    snapshot(table, {
      anchor: "insert",
      narration: `在 ${bucket} 号桶链尾插入 ${target}。插入完成，共 ${
        collectNodes(table).length
      } 个键。`,
      key: target,
      bucket,
      active: [node.id],
      settled: compared,
      activeBuckets: [bucket],
      compared: compared.length,
    }),
  );
  return frames;
}

function deleteFrames(table: HashTable, target: number): Frame[] {
  const bucket = hashSlot(target);
  const frames: Frame[] = [
    snapshot(table, {
      anchor: "start",
      narration: `准备删除 ${target}：先查找目标键。`,
    }),
    snapshot(table, {
      anchor: "hash",
      narration: hashLine(target, bucket),
      key: target,
      bucket,
      activeBuckets: [bucket],
    }),
  ];
  const chain = chainOf(table, bucket);
  if (!chain.length) {
    frames.push(
      snapshot(table, {
        anchor: "miss",
        narration: `${bucket} 号桶为空，未找到 ${target}。`,
        key: target,
        bucket,
        activeBuckets: [bucket],
      }),
    );
    return frames;
  }
  const compared: number[] = [];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i];
    const count = compared.length + 1;
    if (node.key === target) {
      frames.push(
        snapshot(table, {
          anchor: "found",
          narration: `找到 ${target}，准备从 ${bucket} 号桶删除。`,
          key: target,
          bucket,
          active: [node.id],
          settled: compared,
          activeBuckets: [bucket],
          compared: count,
        }),
      );
      const prev = i > 0 ? chain[i - 1] : null;
      const next = node.next;
      if (prev) prev.next = next;
      else table[bucket] = next;
      const unique = chain.length === 1;
      let narration: string;
      let active: number[] = [];
      if (unique) {
        narration = `删除 ${bucket} 号桶中唯一的键 ${target}，桶变空。删除完成。`;
      } else if (!prev) {
        narration = `删除 ${bucket} 号桶的链头 ${target}，链头改为 ${next!.key}。删除完成。`;
        active = [next!.id];
      } else {
        narration = `在 ${bucket} 号桶中删除 ${target}，前驱 ${prev.key} 指向${
          next ? `后继 ${next.key}` : "空"
        }。删除完成。`;
        active = [prev.id];
      }
      frames.push(
        snapshot(table, {
          anchor: "remove",
          narration,
          key: target,
          bucket,
          active,
          settled: compared,
          activeBuckets: [bucket],
          compared: count,
        }),
      );
      return frames;
    }
    if (i === chain.length - 1) {
      frames.push(
        snapshot(table, {
          anchor: "miss",
          narration: `未找到 ${target}，删除取消。`,
          key: target,
          bucket,
          active: [node.id],
          settled: compared,
          activeBuckets: [bucket],
          compared: count,
        }),
      );
      return frames;
    }
    frames.push(
      snapshot(table, {
        anchor: "compare",
        narration: `比较 ${target} 与 ${node.key}：不相等，沿链继续。`,
        key: target,
        bucket,
        active: [node.id],
        settled: compared,
        activeBuckets: [bucket],
        compared: count,
      }),
    );
    compared.push(node.id);
  }
  return frames;
}

export function hashTableTrace(
  values: number[],
  operation: string,
  value = 0,
): Frame[] {
  validateValues(values);
  if (!OPERATIONS.includes(operation as HashOperation))
    throw new Error("未知操作。");
  if (
    operation !== "create" &&
    (!Number.isInteger(value) || Math.abs(value) > 999)
  )
    throw new Error(TARGET_MESSAGE);

  if (operation === "create") return createFrames(values);
  const table = buildTable(values);
  const nextId = values.length;
  if (operation === "search") return searchFrames(table, value);
  if (operation === "insert") return insertFrames(table, value, nextId);
  return deleteFrames(table, value);
}

export const hashTable: ReadyTopic = {
  id: "hash-table",
  group: "tree-hash",
  title: "哈希表",
  badge: "O(1)",
  summary: "除留余数法定位桶，链地址法处理冲突，支持创建、查找、插入与删除。",
  status: "ready",
  scene: "hash",
  icon: Hash,
  controls: {
    dataLabel: "键序列",
    defaultValues: DEFAULT_VALUES,
    defaultInput: DEFAULT_INPUT,
    parseInput: parseHashInput,
    limit: MAX_KEYS,
    defaultOperation: "search",
    randomizable: false,
    operations: [
      { id: "create", label: "创建" },
      { id: "search", label: "查找" },
      { id: "insert", label: "插入" },
      { id: "delete", label: "删除" },
    ],
    value: {
      label: "目标键",
      onlyFor: ["search", "insert", "delete"],
      defaultValue: 8,
    },
  },
  legend: [
    { label: "当前桶 / 当前键", tone: "pivot" },
    { label: "已比较", tone: "active" },
    { label: "空桶 / 未访问", tone: "idle" },
  ],
  theory: [
    {
      title: "核心思路",
      icon: BookOpen,
      body: "哈希表用哈希函数把键直接映射到桶，理想情况下一次就能定位，不需要像查找树那样逐个比较。本演示固定 7 个桶，使用除留余数法；不同键落到同一个桶叫冲突，用链地址法把冲突键串成一条链。查找、插入、删除都先定位桶，再沿链处理。",
      items: [
        "哈希函数负责把键变成 0 到 6 的桶号。",
        "冲突不可避免：7 个桶装不下很多互不相同的键。",
        "链地址法把同一个桶的键按插入顺序挂在一条链上，不覆盖旧键。",
      ],
    },
    {
      title: "先认识几个词",
      icon: Hash,
      body: "先分清六个词，后面的动画和代码就能对上号：",
      items: [
        "键：要存或要查的数据，例如 50、23、8。",
        "桶：数组里的一个位置；本演示有 0 到 6 共 7 个桶。",
        "哈希函数：把键换算成桶号的规则。",
        "冲突：两个不同的键算出了同一个桶号。",
        "链地址法：同一个桶里的键串成一条链，链头挂在桶上。",
        "负载因子：键数 n 除以桶数 7，记作 α = n / 7；它越大，链平均越长。",
      ],
    },
    {
      title: "哈希函数怎么算",
      icon: ScanLine,
      body: "本演示用除留余数法：h(key) = ((key % 7) + 7) % 7。先加 7 再取模，是为了让负键也落在 0 到 6 之间。",
      items: [
        "50 → 1，23 → 2，60 → 4，8 → 1，-1 → 6。",
        "默认数据的分布：1 号桶是 50 → 15 → 36 → 8，2 号桶是 23 → 44，4 号桶是 60，其余桶为空。",
        "同一个键每次计算都会得到同一个桶号，所以查找时能直接回到原位置。",
      ],
    },
    {
      title: "一次查找怎么走",
      icon: ScanLine,
      body: "以默认查找 8 为例，先算出 h(8) = 1，然后只处理 1 号桶：",
      items: [
        "从链头开始比较 50、15、36，它们都不等于 8，已经比较过的键在动画里变蓝。",
        "继续比较链尾的 8，相等，命中。",
        "如果桶是空的，例如查找 10 时的 3 号桶，直接判定未找到，不需要比较。",
        "如果走到链尾仍不相等，例如在 1 号桶查找 29，也判定未找到。",
      ],
    },
    {
      title: "冲突链的插入与删除",
      icon: Split,
      body: "链地址法把同一个桶的冲突键保留下来，插入和删除都只改这一条链：",
      items: [
        "插入 29：先沿 1 号桶查重，没有相同键，再把 29 追加到链尾。",
        "插入已存在的 44：2 号桶里能找到 44，只提示已存在，不重复插入。",
        "删除 15：15 在 1 号桶中间，让前驱 50 指向后继 36。",
        "删除 50：50 是 1 号桶的链头，把桶头改成 15。",
        "删除 8：8 是链尾，让前驱 36 指向空；删除 60：4 号桶只有它，删除后桶变空。",
        "本演示固定 7 个桶，不做扩容或再哈希。",
      ],
    },
    {
      title: "复杂度",
      icon: Gauge,
      body: "设键数为 n、桶数为 7，负载因子 α = n / 7。计算桶号只做一次取模，O(1)；按下标取桶头也是 O(1)。真正花时间的是沿链扫描：查找只走目标桶的一条链，平均链长为 α，所以平均 O(1 + α)；所有键都冲突到同一个桶时，循环要走 n 个节点，最坏 O(n)。插入先沿链查重再在链尾追加，删除要先找到目标并保存前驱，两者平均 O(1 + α)、最坏 O(n)。空间上，n 个键节点加 7 个桶头，总共 O(n + 7)，也就是 O(n)。",
      rows: [
        { label: "平均查找", value: "O(1 + α)" },
        { label: "最坏查找", value: "O(n)" },
        { label: "插入 / 删除（平均）", value: "O(1 + α)" },
        { label: "插入 / 删除（最坏）", value: "O(n)" },
        { label: "空间", value: "O(n + 7)" },
      ],
    },
    {
      title: "易错点",
      icon: TriangleAlert,
      body: "哈希表最容易错在取模、链头和删除时的指针改接。",
      items: [
        "负数直接取模会得到负桶号；必须先归一化，本演示用 ((key % 7) + 7) % 7。",
        "输入不允许重复键；对已存在的键执行插入时只提示，不改变结构。",
        "删除链头时一定要同步修改桶头，否则这个节点仍然能被访问到。",
        "删除中间节点要保留前驱；只改当前节点的 next 不会把链接回去。",
        "冲突不会覆盖旧键，链会变长；键越多，平均查找越慢。",
        "桶数固定为 7 是演示设定；真实哈希表通常会在负载因子过高时扩容。",
      ],
    },
  ],
  trace: ({ values, operation, value }: TraceInput) =>
    hashTableTrace(values, operation, value),
  code: (language, operation) =>
    parseCode(
      templates[language][operation] ?? templates[language].search,
    ),
};
