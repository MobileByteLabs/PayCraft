export declare class PayCraftWeb {
    email(): Nullable<string>;
    claimOffer(offerId: string): boolean;
}
export declare class WebOffer {
    get id(): string;
    get percentOff(): number;
}
