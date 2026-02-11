{
  "lexicon": 1,
  "id": "garden.spores.site.profile",
  "defs": {
    "main": {
      "type": "record",
      "description": "Custom profile information for spores.garden sites",
      "record": {
        "type": "object",
        "properties": {
          "displayName": {
            "type": "string",
            "maxLength": 200,
            "description": "Display name"
          },
          "description": {
            "type": "string",
            "maxLength": 5000,
            "description": "Profile description/bio"
          },
          "avatar": {
            "type": "blob",
            "accept": ["image/png", "image/jpeg", "image/webp", "image/gif"],
            "maxSize": 1000000,
            "description": "Avatar image blob"
          },
          "banner": {
            "type": "blob",
            "accept": ["image/png", "image/jpeg", "image/webp", "image/gif"],
            "maxSize": 2000000,
            "description": "Banner image blob"
          },
          "createdAt": {
            "type": "string",
            "format": "datetime",
            "description": "Creation timestamp"
          },
          "updatedAt": {
            "type": "string",
            "format": "datetime",
            "description": "Last update timestamp"
          }
        }
      }
    }
  }
}
