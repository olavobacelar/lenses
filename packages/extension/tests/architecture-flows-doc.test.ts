import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The architecture flow atlas (docs/architecture-flows.html) renders entirely
// from an embedded JSON document. These tests guard its referential integrity
// so that editing flows by hand can't silently break the page.

const htmlPath = fileURLToPath(
  new URL("../../../docs/architecture-flows.html", import.meta.url),
);

type Step = {
  from?: string;
  to?: string;
  at?: string;
  via?: string;
  route?: string;
  label: string;
  detail: string;
};

type FlowData = {
  canvas: { width: number; height: number };
  groups: { id: string; label: string; x: number; y: number; w: number; h: number }[];
  nodes: {
    id: string;
    group: string;
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
    desc: string;
    files: string[];
  }[];
  transports: Record<string, { label: string; color: string }>;
  flows: { id: string; category: string; title: string; summary: string; steps: Step[] }[];
};

function loadFlowData(): FlowData {
  const html = readFileSync(htmlPath, "utf8");
  const match = html.match(
    /<script type="application\/json" id="flow-data">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("flow-data JSON block not found in architecture-flows.html");
  return JSON.parse(match[1]);
}

describe("architecture flow atlas document", () => {
  const data = loadFlowData();
  const nodeIds = new Set(data.nodes.map((n) => n.id));
  const groupIds = new Set(data.groups.map((g) => g.id));
  const transportIds = new Set(Object.keys(data.transports));

  it("parses as JSON with the expected top-level shape", () => {
    expect(data.canvas.width).toBeGreaterThan(0);
    expect(data.groups.length).toBeGreaterThan(0);
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.flows.length).toBeGreaterThan(0);
  });

  it("has unique node, group, and flow ids", () => {
    expect(nodeIds.size).toBe(data.nodes.length);
    expect(groupIds.size).toBe(data.groups.length);
    const flowIds = data.flows.map((f) => f.id);
    expect(new Set(flowIds).size).toBe(flowIds.length);
  });

  it("assigns every node to an existing group", () => {
    for (const node of data.nodes) {
      expect(groupIds, `node ${node.id} references group ${node.group}`).toContain(node.group);
    }
  });

  it("keeps every node inside its group's bounds", () => {
    const groupsById = new Map(data.groups.map((g) => [g.id, g]));
    for (const node of data.nodes) {
      const g = groupsById.get(node.group)!;
      expect(node.x, `node ${node.id} x`).toBeGreaterThanOrEqual(g.x);
      expect(node.y, `node ${node.id} y`).toBeGreaterThanOrEqual(g.y);
      expect(node.x + node.w, `node ${node.id} right edge`).toBeLessThanOrEqual(g.x + g.w);
      expect(node.y + node.h, `node ${node.id} bottom edge`).toBeLessThanOrEqual(g.y + g.h);
    }
  });

  it("references only existing nodes and transports from flow steps", () => {
    for (const flow of data.flows) {
      for (const [i, step] of flow.steps.entries()) {
        const where = `${flow.id} step ${i + 1}`;
        if (step.at) {
          expect(nodeIds, `${where} 'at'`).toContain(step.at);
          expect(step.from, `${where} pulse step must not have 'from'`).toBeUndefined();
          expect(step.to, `${where} pulse step must not have 'to'`).toBeUndefined();
        } else {
          expect(nodeIds, `${where} 'from'`).toContain(step.from!);
          expect(nodeIds, `${where} 'to'`).toContain(step.to!);
          expect(step.from).not.toBe(step.to);
          expect(transportIds, `${where} 'via'`).toContain(step.via!);
        }
        if (step.route) {
          expect(["left", "right", "top", "bottom"], `${where} 'route'`).toContain(step.route);
        }
      }
    }
  });

  it("gives every flow and step human-readable text", () => {
    for (const flow of data.flows) {
      expect(flow.title.length).toBeGreaterThan(0);
      expect(flow.summary.length).toBeGreaterThan(0);
      expect(flow.category.length).toBeGreaterThan(0);
      for (const step of flow.steps) {
        expect(step.label.length, `${flow.id}: step label`).toBeGreaterThan(0);
        expect(step.detail.length, `${flow.id}: step detail`).toBeGreaterThan(20);
      }
    }
  });
});
