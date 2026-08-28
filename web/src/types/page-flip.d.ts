declare module "page-flip" {
  export type PageFlipCorner = "top" | "bottom";
  export type PageFlipOrientation = "portrait" | "landscape";
  export type PageFlipState = "user_fold" | "fold_corner" | "flipping" | "read";

  export interface PageFlipSettings {
    autoSize: boolean;
    clickEventForward: boolean;
    disableFlipByClick: boolean;
    drawShadow: boolean;
    flippingTime: number;
    height: number;
    maxHeight: number;
    maxShadowOpacity: number;
    maxWidth: number;
    minHeight: number;
    minWidth: number;
    mobileScrollSupport: boolean;
    showCover: boolean;
    showPageCorners: boolean;
    size: "fixed" | "stretch";
    startPage: number;
    startZIndex: number;
    swipeDistance: number;
    useMouseEvents: boolean;
    usePortrait: boolean;
    width: number;
  }

  export interface PageFlipEvent<TData = number | string | boolean | object | null> {
    data: TData;
    object: PageFlip;
  }

  export class PageFlip {
    constructor(element: HTMLElement, settings: Partial<PageFlipSettings>);
    clear(): void;
    destroy(): void;
    flip(page: number, corner?: PageFlipCorner): void;
    flipNext(corner?: PageFlipCorner): void;
    flipPrev(corner?: PageFlipCorner): void;
    getCurrentPageIndex(): number;
    getOrientation(): PageFlipOrientation;
    getPageCount(): number;
    getState(): PageFlipState;
    loadFromHTML(items: NodeListOf<HTMLElement> | HTMLElement[]): void;
    off(event: string): void;
    on(event: "changeState", callback: (event: PageFlipEvent<PageFlipState>) => void): this;
    on(event: "flip", callback: (event: PageFlipEvent<number>) => void): this;
    on(
      event: "init" | "update",
      callback: (event: PageFlipEvent<{ page: number; mode: PageFlipOrientation }>) => void,
    ): this;
    on(event: string, callback: (event: PageFlipEvent) => void): this;
    turnToNextPage(): void;
    turnToPage(page: number): void;
    turnToPrevPage(): void;
    update(): void;
    updateFromHtml(items: NodeListOf<HTMLElement> | HTMLElement[]): void;
  }
}
