declare class QRCode {
  constructor(typeNumber: number, errorCorrectLevel: number);

  addData(data: string): void;
  make(): void;
  isDark(row: number, column: number): boolean;
  getModuleCount(): number;
}

export = QRCode;
