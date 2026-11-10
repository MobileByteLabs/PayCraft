type Nullable<T> = T | null | undefined
declare function KtSingleton<T>(): T & (abstract new() => any);
export declare class WebProduct {
    constructor(sku: string, name: string, type: Nullable<string>, interval: Nullable<string>, amountCents: number, currency: string, trialDays: Nullable<number>);
    get sku(): string;
    get name(): string;
    get type(): Nullable<string>;
    get interval(): Nullable<string>;
    get amountCents(): number;
    get currency(): string;
    get trialDays(): Nullable<number>;
}
export declare namespace WebProduct {
    /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
    namespace $metadata$ {
        const constructor: abstract new () => WebProduct;
    }
}
export declare class WebConfig {
    constructor(products: Array<WebProduct>, providers: Array<string>, googleClientId: Nullable<string>, appleServicesId: Nullable<string>, mode: Nullable<string>);
    get products(): Array<WebProduct>;
    get providers(): Array<string>;
    get googleClientId(): Nullable<string>;
    get appleServicesId(): Nullable<string>;
    get mode(): Nullable<string>;
}
export declare namespace WebConfig {
    /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
    namespace $metadata$ {
        const constructor: abstract new () => WebConfig;
    }
}
export declare class PremiumState {
    constructor(isPremium: boolean, tokenValid: boolean, email: Nullable<string>);
    get isPremium(): boolean;
    get tokenValid(): boolean;
    get email(): Nullable<string>;
}
export declare namespace PremiumState {
    /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
    namespace $metadata$ {
        const constructor: abstract new () => PremiumState;
    }
}
export declare class SignInResult {
    constructor(email: string, conflict: boolean, conflictingDeviceName: Nullable<string>);
    get email(): string;
    get conflict(): boolean;
    get conflictingDeviceName(): Nullable<string>;
}
export declare namespace SignInResult {
    /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
    namespace $metadata$ {
        const constructor: abstract new () => SignInResult;
    }
}
export declare class WebSubscription {
    constructor(plan: Nullable<string>, status: Nullable<string>, provider: Nullable<string>, renewsAt: Nullable<string>, cancelAtPeriodEnd: boolean, trialEndsAt: Nullable<string>);
    get plan(): Nullable<string>;
    get status(): Nullable<string>;
    get provider(): Nullable<string>;
    get renewsAt(): Nullable<string>;
    get cancelAtPeriodEnd(): boolean;
    get trialEndsAt(): Nullable<string>;
}
export declare namespace WebSubscription {
    /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
    namespace $metadata$ {
        const constructor: abstract new () => WebSubscription;
    }
}
export declare class PayCraftWebError extends /* Exception */ Error {
    constructor(code: string, message: string);
    get code(): string;
}
export declare namespace PayCraftWebError {
    /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
    namespace $metadata$ {
        const constructor: abstract new () => PayCraftWebError;
    }
}
export declare class PayCraftWeb {
    constructor(apiKey: string, mode?: Nullable<string>, backendUrl?: Nullable<string>, anonKey?: string);
    config(): Promise<WebConfig>;
    signIn(provider: string, idToken: string, nonce: Nullable<string>): Promise<SignInResult>;
    useThisDevice(): Promise<boolean>;
    premium(): Promise<PremiumState>;
    subscription(): Promise<Nullable<WebSubscription>>;
    isPremium(): boolean;
    email(): Nullable<string>;
    checkoutUrl(sku: string, currency: Nullable<string>): Promise<string>;
    signOut(): void;
}
export declare namespace PayCraftWeb {
    /** @deprecated $metadata$ is used for internal purposes, please don't use it in your code, because it can be removed at any moment */
    namespace $metadata$ {
        const constructor: abstract new () => PayCraftWeb;
    }
}
