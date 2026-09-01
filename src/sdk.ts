export interface AddonDocument<T> {
  readonly key: string;
  readonly revision: number;
  readonly value: T;
}

export interface AddonCommitReceipt {
  readonly results: readonly {
    readonly dataId: string;
    readonly key: string;
    readonly afterRevision: number;
  }[];
}

export interface AddonDataHandle<T> {
  get(key: string, options?: { readonly signal?: AbortSignal }): Promise<AddonDocument<T>>;
  put(key: string, value: T, expectedRevision: number, options?: { readonly signal?: AbortSignal }): Promise<AddonCommitReceipt>;
}

export interface ServiceProvider {
  readonly addonId: string;
  readonly contractVersion: string;
  readonly generation: string;
  readonly bindingRevision: number;
}

export interface ServiceHandle {
  readonly available: boolean;
  readonly providers: readonly ServiceProvider[];
  call<TResponse>(method: string, params: unknown, options?: {
    readonly deadlineMs?: number;
    readonly signal?: AbortSignal;
  }): Promise<TResponse>;
}

export interface AddonContext {
  readonly addon: { readonly id: string; readonly version: string; readonly generation: string };
  readonly signal: AbortSignal;
  readonly capabilities: { require(capability: string): void };
  readonly data: {
    recordExtension<T>(target: string, id: string): AddonDataHandle<T>;
  };
  readonly services: {
    connect(contract: string, options: {
      readonly range: string;
      readonly cardinality: "one";
      readonly signal?: AbortSignal;
    }): Promise<ServiceHandle>;
  };
  readonly ui: {
    bind(contributionId: string, binding: { readonly kind: "element"; readonly tag: string }): { dispose(): void };
  };
}

export interface RecordContributionHostContext {
  readonly kind: "campaign-record";
  readonly collection: string;
  readonly key: string;
  readonly revision: number;
  readonly value: unknown;
  readonly canEdit: boolean;
}

export interface ContributionContext {
  readonly addon: { readonly id: string; readonly generation: string };
  readonly contribution: { readonly id: string; readonly config: Readonly<Record<string, unknown>> };
  readonly signal: AbortSignal;
  readonly host: RecordContributionHostContext;
}

export interface Disposable {
  dispose(): void | Promise<void>;
}
