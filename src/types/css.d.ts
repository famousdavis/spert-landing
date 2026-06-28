// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
//
// Ambient declaration for side-effect CSS imports (*.css).
// WE-8 Next App Router precedent: import './globals.css' at layout.tsx:3
// requires this shim under TypeScript 6.
declare module '*.css';
