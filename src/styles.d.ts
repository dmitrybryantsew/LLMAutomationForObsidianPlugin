/**
 * Type declaration for CSS imports
 * Allows TypeScript to recognize CSS side-effect imports
 */
declare module '*.css' {
    const content: { [className: string]: any };
    export default content;
}
