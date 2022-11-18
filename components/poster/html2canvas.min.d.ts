interface Html2CanvasOptions {
  useCORS?: boolean;
  allowTaint?: boolean;
  scale?: number;
  logging?: boolean;
  [key: string]: any;
}

declare function html2canvas(
  element: HTMLElement,
  options?: Html2CanvasOptions
): Promise<HTMLCanvasElement>;

export default html2canvas;

