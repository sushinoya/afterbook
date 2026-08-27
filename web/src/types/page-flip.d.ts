declare module "page-flip" {
  export type PageFlipCorner = "top" | "bottom";
  export type PageFlipOrientation = "portrait" | "landscape";
  export type PageFlipState = "user_fold" | "fold_corner" | "flipping" | "read";

  export interface PageFlipSettings {
    startPage: number;
    size: "fixed" | "stretch";
    width: number;
    height: number;
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
    drawShadow: boolean;
    flippingTime: number;
    usePortrait: boolean;
    startZIndex: number;
    autoSize: boolean;
    maxShadowOpacity: number;
    showCover: boolean;
    mobileScrollSupport: boolean;
    clickEventForward: boolean;
    useMouseEvents: boolean;
    swipeDistance: number;
    showPageCorners: boolean;
    disableFlipByClick: boolean;
  }

  export interface PageFlipEvent<TData> {
    data: TData;
    object: PageFlip;
  }

  export class PageFlip {
    constructor(element: HTMLElement, settings: Partial<PageFlipSettings>);

    loadFromHTML(items: NodeListOf<HTMLElement> | HTMLElement[]): void;
    updateFromHtml(items: NodeListOf<HTMLElement> | HTMLElement[]): void;
    destroy(): void;
    update(): void;
    clear(): void;
    turnToPage(pageNumber: number): void;
    turnToNextPage(): void;
    turnToPrevPage(): void;
    flipNext(corner?: PageFlipCorner): void;
    flipPrev(corner?: PageFlipCorner): void;
    flip(pageNumber: number, corner?: PageFlipCorner): void;
    getPageCount(): number;
    getCurrentPageIndex(): number;
    getOrientation(): PageFlipOrientation;
    getState(): PageFlipState;
    on(event: "flip", callback: (event: PageFlipEvent<number>) => void): this;
    on(
      event: "changeState",
      callback: (event: PageFlipEvent<PageFlipState>) => void,
    ): this;
    on(
      event: "changeOrientation",
      callback: (event: PageFlipEvent<PageFlipOrientation>) => void,
    ): this;
    on(
      event: "init" | "update",
      callback: (
        event: PageFlipEvent<{ page: number; mode: PageFlipOrientation }>,
      ) => void,
    ): this;
  }

  const pageFlipModule: {
    PageFlip: typeof PageFlip;
  };

  export default pageFlipModule;
}
