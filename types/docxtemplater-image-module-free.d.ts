declare module "docxtemplater-image-module-free" {
  type Size = [number, number];

  interface ImageModuleOptions {
    centered?: boolean;
    fileType?: "docx" | "pptx";
    getImage: (
      tagValue: string
    ) => Promise<ArrayBuffer | Uint8Array | Buffer> | ArrayBuffer | Uint8Array | Buffer;
    getSize: (
      img: ArrayBuffer | Uint8Array | Buffer
    ) => Size | Promise<Size>;
  }

  export default class ImageModule {
    constructor(opts: ImageModuleOptions);
  }
}
