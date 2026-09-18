/* Credit: @paparichens */
declare module "bwip-js" {
  const bwipjs: {
    toSVG(opts: Record<string, unknown>): string;
    toBuffer(opts: Record<string, unknown>): Promise<Buffer>;
  };
  export default bwipjs;
}
