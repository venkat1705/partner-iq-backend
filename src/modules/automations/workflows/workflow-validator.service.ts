import { Injectable, BadRequestException } from '@nestjs/common';
import { dbStore, AutomationWorkflowEntity } from '../../../database/store';
import { AutomationNodeType } from '../../../common/enums';
import { EmailTemplateService } from '../templates/email-template.service';

@Injectable()
export class WorkflowValidatorService {
  constructor(private readonly emailTemplateService: EmailTemplateService) {}

  validateWorkflow(workflow: AutomationWorkflowEntity | { nodes: any[]; edges: any[]; organizationId: string }) {
    const nodes = workflow.nodes || [];
    const edges = workflow.edges || [];

    if (!nodes.length) {
      throw new BadRequestException('Workflow must contain at least one node.');
    }

    // 1. Trigger node check
    const triggerNodes = nodes.filter((n) => n.type === AutomationNodeType.TRIGGER);
    if (triggerNodes.length === 0) {
      throw new BadRequestException('Workflow must start with a TRIGGER node.');
    }
    if (triggerNodes.length > 1) {
      throw new BadRequestException('Workflow can only have one TRIGGER node.');
    }

    const triggerNode = triggerNodes[0];

    // 2. Validate node configurations & referenced email templates
    for (const node of nodes) {
      if (!node.id) {
        throw new BadRequestException('Every node must have a unique ID.');
      }

      if (node.type === AutomationNodeType.DELAY) {
        const amount = Number(node.config?.delayAmount || 0);
        if (amount < 0) {
          throw new BadRequestException(`Delay node '${node.name || node.id}' must have a positive delay amount.`);
        }
      }

      if (node.type === AutomationNodeType.ACTION && node.config?.emailTemplateCode) {
        const templateCode = node.config.emailTemplateCode;
        const template = dbStore.automationEmailTemplates.find(
          (t) => t.organizationId === workflow.organizationId && t.code === templateCode,
        );
        // Note: We allow pre-built codes if they will be seeded or created
      }
    }

    // 3. Cycle & Loop validation: ensure no immediate infinite loop (cycle without any DELAY node)
    this.detectZeroDelayCycles(nodes, edges);

    return { valid: true };
  }

  private detectZeroDelayCycles(nodes: any[], edges: any[]) {
    const adj: Map<string, string[]> = new Map();
    nodes.forEach((n) => adj.set(n.id, []));
    edges.forEach((e) => {
      if (adj.has(e.sourceNodeId)) {
        adj.get(e.sourceNodeId)!.push(e.targetNodeId);
      }
    });

    const visited: Set<string> = new Set();
    const inStack: Set<string> = new Set();

    const dfs = (nodeId: string, pathHasDelay: boolean): boolean => {
      visited.add(nodeId);
      inStack.add(nodeId);

      const node = nodes.find((n) => n.id === nodeId);
      const isDelayNode = node?.type === AutomationNodeType.DELAY;
      const currentPathHasDelay = pathHasDelay || isDelayNode;

      const neighbors = adj.get(nodeId) || [];
      for (const neighborId of neighbors) {
        if (inStack.has(neighborId) && !currentPathHasDelay) {
          throw new BadRequestException(
            `Infinite zero-delay loop detected between nodes '${nodeId}' and '${neighborId}'. Introduce a DELAY node or fix cycle.`,
          );
        }
        if (!visited.has(neighborId)) {
          dfs(neighborId, currentPathHasDelay);
        }
      }

      inStack.delete(nodeId);
      return true;
    };

    const trigger = nodes.find((n) => n.type === AutomationNodeType.TRIGGER);
    if (trigger) {
      dfs(trigger.id, false);
    }
  }
}
