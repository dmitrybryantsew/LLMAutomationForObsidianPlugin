export interface PathStructure {
  version: string;
  lastUpdated: string;
  rootPath: string; // Top-level container path within the vault for the structure's MD files
  structure: {
    domains: Domain[];
  };
}

export interface Domain {
  id: string;
  name: string;
  description?: string;
  folderPath: string; // Relative to rootPath (e.g., "Programming")
  subjects: Subject[];
  mdFile?: string; // Full path to the entry point MD file (e.g., "Paths/Domains/Programming/programming.md")
  dateCreated: string;
  dateModified: string;
}
  
export interface Subject {
  id: string;
  name: string;
  description?: string;
  folderPath: string; // Relative to domain folder (e.g., "Unreal_Engine_5")
  topics: Topic[];
  mdFile?: string; // Full path (e.g., "Paths/Domains/Programming/Unreal_Engine_5/unreal-engine-5.md")
  dateCreated: string;
  dateModified: string;
}
export interface Topic {
  id: string;
  name: string;
  description?: string;
  folderPath: string; // Relative to subject folder (e.g., "Game_Development")
  series: Series[];
  mdFile?: string; // Full path (e.g., "Paths/Domains/Programming/Unreal_Engine_5/Game_Development/game-development.md")
  dateCreated: string;
  dateModified: string;
}
  
export interface Series {
  id: string;
  name: string;
  description?: string;
  folderPath: string; // Relative to topic folder (e.g., "Tank_Tutorial_Series")
  authors: Author[]; // Authors are nested within Series
  mdFile?: string; // Full path (e.g., "Paths/Domains/Programming/Unreal_Engine_5/Game_Development/Tank_Tutorial_Series/tank-tutorial-series.md")
  dateCreated: string;
  dateModified: string;
}
  
// Added description and dates to Author
  export interface Author {
    id: string;
    name: string;
    description?: string; // Added description for Author
    content: Content[]; // Content items are nested within Author
    mdFile?: string; // Full path to the author's MD file (e.g., "Paths/Domains/.../Series_Folder/author-name.md")
    dateCreated: string; // Added dateCreated
    dateModified: string; // Added dateModified
  }
  
  export interface Content {
    id: string;
    title: string;
    subtitle?: string;
    position?: number;
    totalParts?: number;
    filePath: string; // <-- This is the ACTUAL path to the content file (e.g., "VideoSummaries/Ryan Laley/UE5 Tank Part 1.md")
    videoUrl?: string; // Changed to optional, as content might not always be video
    dateAdded: string;
  }
  
  export interface ContentMetadata {
    title: string;
    subtitle?: string;
    position?: number;
    totalParts?: number;
    videoUrl?: string; // Changed to optional
    filePath: string; // <-- Pass the actual file path when linking content
    // These are used to identify the parent entity in the structure by ID, NOT to generate the file path for the content itself
    domain: string; // Should be the domain ID
    subject: string; // Should be the subject ID
    topic: string; // Should be the topic ID
    series: string; // Should be the series ID
    author: string; // Should be the author ID
  }