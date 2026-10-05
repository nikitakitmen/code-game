import type { ArchNode, ComponentDef, ContentBundle, NodeRole, Size, World } from './types';

export const SIZE_FACTOR: Record<Size, number> = { s: 1, m: 2, l: 4, xl: 8, '2xl': 16 };

export function componentDef(content: ContentBundle, type: string): ComponentDef {
  const def = content.components.find((c) => c.type === type);
  if (!def) throw new Error(`Unknown component type "${type}"`);
  return def;
}

export function maybeComponent(content: ContentBundle, type: string): ComponentDef | undefined {
  return content.components.find((c) => c.type === type);
}

export function roleOf(content: ContentBundle, node: ArchNode): NodeRole {
  return componentDef(content, node.type).role;
}

export function nodesByRole(content: ContentBundle, world: World, role: NodeRole): ArchNode[] {
  return world.nodes.filter((n) => maybeComponent(content, n.type)?.role === role);
}

export function sizeFactor(node: ArchNode, def: ComponentDef): number {
  return def.scalable ? SIZE_FACTOR[node.size] ?? 1 : 1;
}

/** Monthly cost of a node in game money. */
export function nodeCost(content: ContentBundle, node: ArchNode): number {
  const def = componentDef(content, node.type);
  if (node.offline && !def.external) return Math.round(def.costPerMonth * 0.1 * sizeFactor(node, def));
  let cost = def.costPerMonth * sizeFactor(node, def);
  if (def.role === 'cache') cost = def.costPerMonth * (Number(node.config.memoryMb ?? def.capacity) / def.capacity);
  if (def.role === 'cdn') {
    const edges = String(node.config.edges ?? 'eu').split(',').filter(Boolean).length;
    cost = def.costPerMonth * Math.max(1, edges);
  }
  return Math.round(cost);
}

export function nodeLabel(node: ArchNode): string {
  return node.name || node.type;
}
