import { Injectable, NestMiddleware, ForbiddenException, UnauthorizedException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export type PolicyEffect = 'ALLOW' | 'DENY';

export enum ActionType {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  EXECUTE = 'EXECUTE',
  MANAGE = 'MANAGE',
  AUDIT = 'AUDIT',
}

export enum SecurityClassification {
  PUBLIC = 0,
  INTERNAL = 1,
  CONFIDENTIAL = 2,
  RESTRICTED = 3,
  TOP_SECRET = 4,
}

export interface UserDelegation {
  delegatorId: string;
  roles: string[];
  expiresAt: number;
  scope: string;
}

export interface UserContext {
  id: string;
  tenantId: string;
  roles: string[];
  clearanceLevel: SecurityClassification;
  ipAddress: string;
  geoCountry?: string;
  isSuperAdmin: boolean;
  delegations: UserDelegation[];
  attributes: Record<string, any>;
  emergencyBypassToken?: string;
}

export interface ResourceContext {
  id: string;
  type: string;
  tenantId: string;
  path: string;
  classification: SecurityClassification;
  ownerId?: string;
  attributes: Record<string, any>;
  tags: string[];
}

export interface PolicyCondition {
  field: string;
  operator: 'EQUALS' | 'NOT_EQUALS' | 'IN' | 'NOT_IN' | 'GREATER_THAN' | 'LESS_THAN' | 'CONTAINS' | 'MATCHES_PATTERN' | 'IP_IN_RANGE';
  value: any;
}

export interface PolicyRule {
  id: string;
  name: string;
  priority: number;
  effect: PolicyEffect;
  roles: string[];
  actions: (ActionType | string)[];
  resources: string[];
  conditions?: PolicyCondition[];
  timeWindow?: {
    startHourUTC: number;
    endHourUTC: number;
    allowedDaysOfWeek: number[];
  };
  environmentRestrictions?: {
    allowedIPRanges?: string[];
    allowedCountries?: string[];
    disallowMaintenanceWindow?: boolean;
  };
}

export interface AccessPolicySet {
  tenantId: string;
  version: string;
  rules: PolicyRule[];
}

@Injectable()
export class AccessControlPolicyMiddleware implements NestMiddleware {
  private readonly roleHierarchy = new Map<string, string[]>([
    ['SYSTEM_ADMIN', ['TENANT_ADMIN', 'SECURITY_OFFICER', 'AUDITOR', 'PROJECT_MANAGER', 'CONTRIBUTOR', 'VIEWER']],
    ['TENANT_ADMIN', ['PROJECT_MANAGER', 'CONTRIBUTOR', 'VIEWER']],
    ['SECURITY_OFFICER', ['AUDITOR', 'VIEWER']],
    ['PROJECT_MANAGER', ['CONTRIBUTOR', 'VIEWER']],
    ['CONTRIBUTOR', ['VIEWER']],
    ['AUDITOR', ['VIEWER']],
    ['VIEWER', []],
  ]);

  private readonly globalPolicyStore: AccessPolicySet[] = [
    {
      tenantId: '*',
      version: '1.0.0',
      rules: [
        {
          id: 'rule-super-admin-override',
          name: 'Super Admin Full Access',
          priority: 1000,
          effect: 'ALLOW',
          roles: ['SYSTEM_ADMIN'],
          actions: ['*'],
          resources: ['*'],
        },
        {
          id: 'rule-deny-maintenance-general',
          name: 'Block standard users during maintenance',
          priority: 950,
          effect: 'DENY',
          roles: ['CONTRIBUTOR', 'VIEWER'],
          actions: ['CREATE', 'UPDATE', 'DELETE'],
          resources: ['*'],
          environmentRestrictions: {
            disallowMaintenanceWindow: true,
          },
        },
      ],
    },
    {
      tenantId: 'tenant-alpha',
      version: '2.1.0',
      rules: [
        {
          id: 'rule-alpha-owner-manage',
          name: 'Owner full resource access',
          priority: 500,
          effect: 'ALLOW',
          roles: ['PROJECT_MANAGER', 'TENANT_ADMIN'],
          actions: ['READ', 'UPDATE', 'DELETE', 'MANAGE'],
          resources: ['projects/*', 'documents/*'],
          conditions: [
            {
              field: 'resource.ownerId',
              operator: 'EQUALS',
              value: '${user.id}',
            },
          ],
        },
        {
          id: 'rule-alpha-confidential-read',
          name: 'Restricted high clearance access',
          priority: 400,
          effect: 'ALLOW',
          roles: ['SECURITY_OFFICER', 'TENANT_ADMIN'],
          actions: ['READ'],
          resources: ['documents/confidential/*'],
          conditions: [
            {
              field: 'user.clearanceLevel',
              operator: 'GREATER_THAN',
              value: SecurityClassification.CONFIDENTIAL,
            },
          ],
        },
        {
          id: 'rule-alpha-deny-ip-range',
          name: 'Deny restricted subnet for write',
          priority: 900,
          effect: 'DENY',
          roles: ['*'],
          actions: ['CREATE', 'UPDATE', 'DELETE'],
          resources: ['financial/*'],
          environmentRestrictions: {
            allowedIPRanges: ['10.0.0.0/8', '192.168.1.0/24'],
          },
        },
        {
          id: 'rule-alpha-business-hours-only',
          name: 'Restrict operations to business hours',
          priority: 300,
          effect: 'ALLOW',
          roles: ['CONTRIBUTOR'],
          actions: ['CREATE', 'UPDATE'],
          resources: ['tasks/*', 'tickets/*'],
          timeWindow: {
            startHourUTC: 6,
            endHourUTC: 22,
            allowedDaysOfWeek: [1, 2, 3, 4, 5],
          },
        },
      ],
    },
  ];

  private isSystemInMaintenance = false;

  public use(req: Request, res: Response, next: NextFunction): void {
    try {
      const user = this.extractUserContext(req);
      const resource = this.extractResourceContext(req);
      const action = this.resolveAction(req);

      if (this.checkEmergencyBypass(user, req, res)) {
        return next();
      }

      if (!this.validateTenantBoundary(user, resource)) {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          message: 'Cross-tenant access violation detected',
          code: 'TENANT_MISMATCH',
        });
      }

      const effectiveRoles = this.resolveEffectiveRoles(user);
      const applicablePolicies = this.getApplicablePolicies(user.tenantId);

      const evaluationResult = this.evaluateAccessDecision(
        user,
        resource,
        action,
        effectiveRoles,
        applicablePolicies,
        req
      );

      if (evaluationResult.decision === 'DENY') {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          message: `Access denied by policy rule: ${evaluationResult.matchedRuleId || 'DEFAULT_DENY'}`,
          reason: evaluationResult.reason,
          code: 'ACCESS_DENIED_BY_POLICY',
        });
      }

      res.setHeader('X-Access-Control-Evaluated', 'true');
      res.setHeader('X-Access-Control-Decision', 'ALLOW');
      if (evaluationResult.matchedRuleId) {
        res.setHeader('X-Access-Control-Rule-Id', evaluationResult.matchedRuleId);
      }

      next();
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
        throw error;
      }
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Policy evaluation error encountered',
        details: error instanceof Error ? error.message : 'Unknown evaluation failure',
      });
    }
  }

  private extractUserContext(req: Request): UserContext {
    const userId = (req.headers['x-user-id'] as string) || 'anonymous';
    const tenantId = (req.headers['x-tenant-id'] as string) || 'guest-tenant';
    const rawRoles = (req.headers['x-user-roles'] as string) || 'GUEST';
    const roles = rawRoles.split(',').map((r) => r.trim());
    const clearance = parseInt((req.headers['x-user-clearance'] as string) || '0', 10);
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const geoCountry = req.headers['x-geo-country'] as string;
    const isSuperAdmin = req.headers['x-super-admin'] === 'true' || roles.includes('SYSTEM_ADMIN');
    const emergencyBypassToken = req.headers['x-emergency-bypass-token'] as string;

    const delegations = this.parseDelegations(req.headers['x-user-delegations'] as string);
    const attributes = this.parseJsonHeader(req.headers['x-user-attributes'] as string);

    return {
      id: userId,
      tenantId,
      roles,
      clearanceLevel: Number.isNaN(clearance) ? SecurityClassification.PUBLIC : clearance,
      ipAddress: ipAddress.split(',')[0].trim(),
      geoCountry,
      isSuperAdmin,
      delegations,
      attributes,
      emergencyBypassToken,
    };
  }

  private parseDelegations(header?: string): UserDelegation[] {
    if (!header) return [];
    try {
      const parsed = JSON.parse(header);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is UserDelegation =>
          Boolean(item?.delegatorId) &&
          Array.isArray(item?.roles) &&
          typeof item?.expiresAt === 'number'
      );
    } catch {
      return [];
    }
  }

  private parseJsonHeader(header?: string): Record<string, any> {
    if (!header) return {};
    try {
      const parsed = JSON.parse(header);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  private extractResourceContext(req: Request): ResourceContext {
    const resourceId = (req.headers['x-resource-id'] as string) || req.params?.['id'] || 'global';
    const resourceType = (req.headers['x-resource-type'] as string) || this.deriveResourceTypeFromPath(req.path);
    const tenantId = (req.headers['x-resource-tenant-id'] as string) || (req.headers['x-tenant-id'] as string) || 'guest-tenant';
    const classificationVal = parseInt((req.headers['x-resource-classification'] as string) || '0', 10);
    const ownerId = (req.headers['x-resource-owner-id'] as string) || (req.query?.['ownerId'] as string);

    const tagsHeader = req.headers['x-resource-tags'] as string;
    const tags = tagsHeader ? tagsHeader.split(',').map((t) => t.trim()) : [];

    let attributes: Record<string, any> = {};
    if (req.body && typeof req.body === 'object') {
      attributes = { ...req.body };
    }
    if (req.query && typeof req.query === 'object') {
      attributes = { ...attributes, ...req.query };
    }

    return {
      id: resourceId,
      type: resourceType,
      tenantId,
      path: req.path.startsWith('/') ? req.path.substring(1) : req.path,
      classification: Number.isNaN(classificationVal) ? SecurityClassification.PUBLIC : classificationVal,
      ownerId,
      attributes,
      tags,
    };
  }

  private deriveResourceTypeFromPath(path: string): string {
    const cleaned = path.replace(/^\/api\/v\d+\//, '').replace(/^\//, '');
    const segments = cleaned.split('/');
    return segments[0] ? segments[0].toLowerCase() : 'unknown';
  }

  private resolveAction(req: Request): ActionType | string {
    const customAction = req.headers['x-action-override'] as string;
    if (customAction) {
      return customAction.toUpperCase();
    }

    const method = req.method.toUpperCase();
    switch (method) {
      case 'GET':
      case 'HEAD':
      case 'OPTIONS':
        return ActionType.READ;
      case 'POST':
        return ActionType.CREATE;
      case 'PUT':
      case 'PATCH':
        return ActionType.UPDATE;
      case 'DELETE':
        return ActionType.DELETE;
      default:
        return method;
    }
  }

  private checkEmergencyBypass(user: UserContext, req: Request, res: Response): boolean {
    if (user.emergencyBypassToken && user.isSuperAdmin && user.emergencyBypassToken === 'CRITICAL_OVERRIDE_SECRET_99') {
      res.setHeader('X-Access-Control-Bypass', 'TRUE_EMERGENCY');
      return true;
    }
    return false;
  }

  private validateTenantBoundary(user: UserContext, resource: ResourceContext): boolean {
    if (user.isSuperAdmin || user.tenantId === '*' || resource.tenantId === '*') {
      return true;
    }
    if (user.tenantId !== resource.tenantId) {
      return user.roles.includes('CROSS_TENANT_AUDITOR') && resource.classification <= SecurityClassification.CONFIDENTIAL;
    }
    return true;
  }

  private resolveEffectiveRoles(user: UserContext): Set<string> {
    const effectiveRoles = new Set<string>();
    const now = Date.now();

    const expandRole = (role: string): void => {
      if (effectiveRoles.has(role)) return;
      effectiveRoles.add(role);
      const inherited = this.roleHierarchy.get(role);
      if (inherited) {
        for (const childRole of inherited) {
          expandRole(childRole);
        }
      }
    };

    for (const role of user.roles) {
      expandRole(role);
    }

    if (user.delegations) {
      for (const del of user.delegations) {
        if (del.expiresAt > now) {
          for (const role of del.roles) {
            expandRole(role);
          }
        }
      }
    }

    return effectiveRoles;
  }

  private getApplicablePolicies(tenantId: string): PolicyRule[] {
    const applicableRules: PolicyRule[] = [];

    for (const pSet of this.globalPolicyStore) {
      if (pSet.tenantId === '*' || pSet.tenantId === tenantId) {
        applicableRules.push(...pSet.rules);
      }
    }

    return applicableRules.sort((a, b) => b.priority - a.priority);
  }

  private evaluateAccessDecision(
    user: UserContext,
    resource: ResourceContext,
    action: ActionType | string,
    roles: Set<string>,
    rules: PolicyRule[],
    req: Request
  ): { decision: PolicyEffect; matchedRuleId?: string; reason?: string } {
    let hasExplicitAllow = false;
    let allowRuleId: string | undefined;

    for (const rule of rules) {
      if (
        !this.matchRole(rule.roles, roles) ||
        !this.matchAction(rule.actions, action) ||
        !this.matchResource(rule.resources, resource) ||
        !this.evaluateTimeWindow(rule.timeWindow) ||
        !this.evaluateEnvironment(rule.environmentRestrictions, user, req) ||
        !this.evaluateConditions(rule.conditions, user, resource)
      ) {
        continue;
      }

      if (rule.effect === 'DENY') {
        return {
          decision: 'DENY',
          matchedRuleId: rule.id,
          reason: `Explicit DENY by high priority rule: ${rule.name}`,
        };
      }

      if (rule.effect === 'ALLOW' && !hasExplicitAllow) {
        hasExplicitAllow = true;
        allowRuleId = rule.id;
      }
    }

    if (hasExplicitAllow) {
      return {
        decision: 'ALLOW',
        matchedRuleId: allowRuleId,
      };
    }

    return {
      decision: 'DENY',
      reason: 'Implicit DEFAULT_DENY (No rule matched or granted explicit ALLOW)',
    };
  }

  private matchRole(ruleRoles: string[], userRoles: Set<string>): boolean {
    if (ruleRoles.includes('*')) {
      return true;
    }
    return ruleRoles.some((role) => userRoles.has(role));
  }

  private matchAction(ruleActions: (ActionType | string)[], requestAction: ActionType | string): boolean {
    const targetAction = requestAction.toUpperCase();
    return ruleActions.some((act) => {
      const actUpper = act.toUpperCase();
      return actUpper === '*' || actUpper === ActionType.MANAGE || actUpper === targetAction;
    });
  }

  private matchResource(ruleResources: string[], resource: ResourceContext): boolean {
    const resourcePathAndId = `${resource.type}/${resource.id}`;
    return ruleResources.some(
      (pattern) =>
        pattern === '*' ||
        this.globMatch(pattern, resource.path) ||
        this.globMatch(pattern, resourcePathAndId)
    );
  }

  private globMatch(pattern: string, target: string): boolean {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(target);
  }

  private evaluateTimeWindow(window?: PolicyRule['timeWindow']): boolean {
    if (!window) {
      return true;
    }

    const now = new Date();
    const currentUTCHour = now.getUTCHours();
    const currentUTCDay = now.getUTCDay();

    if (window.allowedDaysOfWeek && window.allowedDaysOfWeek.length > 0) {
      if (!window.allowedDaysOfWeek.includes(currentUTCDay)) {
        return false;
      }
    }

    if (window.startHourUTC !== undefined && window.endHourUTC !== undefined) {
      if (window.startHourUTC <= window.endHourUTC) {
        if (currentUTCHour < window.startHourUTC || currentUTCHour >= window.endHourUTC) {
          return false;
        }
      } else {
        if (currentUTCHour < window.startHourUTC && currentUTCHour >= window.endHourUTC) {
          return false;
        }
      }
    }

    return true;
  }

  private evaluateEnvironment(
    env: PolicyRule['environmentRestrictions'],
    user: UserContext,
    req: Request
  ): boolean {
    if (!env) {
      return true;
    }

    if (env.disallowMaintenanceWindow && this.isSystemInMaintenance) {
      return false;
    }

    if (env.allowedCountries && env.allowedCountries.length > 0) {
      if (!user.geoCountry || !env.allowedCountries.includes(user.geoCountry.toUpperCase())) {
        return false;
      }
    }

    if (env.allowedIPRanges && env.allowedIPRanges.length > 0) {
      const ipAllowed = env.allowedIPRanges.some((range) => this.isIPInCIDR(user.ipAddress, range));
      if (!ipAllowed) {
        return false;
      }
    }

    return true;
  }

  private evaluateConditions(
    conditions: PolicyCondition[] | undefined,
    user: UserContext,
    resource: ResourceContext
  ): boolean {
    if (!conditions || conditions.length === 0) {
      return true;
    }

    for (const cond of conditions) {
      const leftValue = this.resolveValuePath(cond.field, user, resource);
      let rightValue = cond.value;

      if (typeof rightValue === 'string' && rightValue.startsWith('${') && rightValue.endsWith('}')) {
        const path = rightValue.substring(2, rightValue.length - 1);
        rightValue = this.resolveValuePath(path, user, resource);
      }

      if (!this.checkConditionOperator(cond.operator, leftValue, rightValue)) {
        return false;
      }
    }

    return true;
  }

  private checkConditionOperator(operator: PolicyCondition['operator'], leftValue: any, rightValue: any): boolean {
    switch (operator) {
      case 'EQUALS':
        return leftValue === rightValue;
      case 'NOT_EQUALS':
        return leftValue !== rightValue;
      case 'GREATER_THAN':
        return leftValue > rightValue;
      case 'LESS_THAN':
        return leftValue < rightValue;
      case 'IN':
        return Array.isArray(rightValue) && rightValue.includes(leftValue);
      case 'NOT_IN':
        return !Array.isArray(rightValue) || !rightValue.includes(leftValue);
      case 'CONTAINS':
        if (Array.isArray(leftValue)) {
          return leftValue.includes(rightValue);
        }
        if (typeof leftValue === 'string') {
          return leftValue.includes(String(rightValue));
        }
        return false;
      case 'MATCHES_PATTERN':
        return typeof leftValue === 'string' && new RegExp(String(rightValue)).test(leftValue);
      case 'IP_IN_RANGE':
        return typeof leftValue === 'string' && this.isIPInCIDR(leftValue, String(rightValue));
      default:
        return false;
    }
  }

  private resolveValuePath(path: string, user: UserContext, resource: ResourceContext): any {
    const parts = path.split('.');
    let current: any;

    if (parts[0] === 'user') {
      current = user;
    } else if (parts[0] === 'resource') {
      current = resource;
    } else {
      return undefined;
    }

    for (let i = 1; i < parts.length; i++) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[parts[i]];
    }

    return current;
  }

  private isIPInCIDR(ip: string, cidr: string): boolean {
    if (!cidr.includes('/')) {
      return ip === cidr;
    }

    const [range, bits] = cidr.split('/');
    const mask = ~(Math.pow(2, 32 - parseInt(bits, 10)) - 1);

    const ipToLong = (ipAddr: string): number => {
      const components = ipAddr.split('.');
      if (components.length !== 4) return 0;
      return (
        ((parseInt(components[0], 10) << 24) >>> 0) +
        ((parseInt(components[1], 10) << 16) >>> 0) +
        ((parseInt(components[2], 10) << 8) >>> 0) +
        (parseInt(components[3], 10) >>> 0)
      );
    };

    return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
  }
}