import { type IZenPair } from './types.js';
export declare function encrypt(data: any, key: string | IZenPair, zenInstance?: any): Promise<any>;
export declare function decrypt(encryptedData: any, key: string | IZenPair, zenInstance?: any): Promise<any>;
export declare function sign(data: any, pair: IZenPair, zenInstance?: any): Promise<any>;
export declare function verify(data: any, pub: string, zenInstance?: any): Promise<any>;
export declare function secret(epub: string, pair: IZenPair, zenInstance?: any): Promise<any>;
export declare function certify(who: string | string[], policy: any, pair: IZenPair, zenInstance?: any): Promise<any>;
export declare function generatePairFromSeed(seedPhrase: string, salt?: string | null, zenInstance?: any): Promise<IZenPair>;
export declare function pair(zenInstance?: any): Promise<IZenPair>;
