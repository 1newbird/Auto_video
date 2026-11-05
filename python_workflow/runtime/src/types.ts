export type BaseItem = {id: string; at: number; rotate?: number};
export type TextItem = BaseItem & {
  kind: 'text'; x: number; y: number; text: string; size: number;
  color?: string; spacing?: number; anchor?: 'start' | 'middle' | 'end';
};
export type ShapeItem = BaseItem & {
  kind: 'path'; path: string; color?: string; width?: number; roughness?: number; seed: number;
};
export type BoardItem = TextItem | ShapeItem;
export type BoardData = {
  width: number; height: number; fps: number; duration: number;
  paper: {color: string; ink: string; red: string; rotation: number; top: number; finish?: 'warm' | 'white'};
  qa?: {staticHeaderHeight?: number};
  items: BoardItem[];
};
