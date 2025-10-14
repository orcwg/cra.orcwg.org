const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const data = require('./data.js');

const LISTS_DIR = path.join(__dirname, "..", "_lists");

function loadCuratedListsFromYAML() {
  const listsConfig = {};

  if (!fs.existsSync(LISTS_DIR)) {
    return listsConfig;
  }

  const files = fs.readdirSync(LISTS_DIR);
  for (const file of files) {
    if (file.endsWith('.yaml') || file.endsWith('.yml')) {
      const filePath = path.join(LISTS_DIR, file);
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const listKey = file.replace(/\.(yaml|yml)$/, '');

      try {
        const listConfig = yaml.load(fileContent);
        listsConfig[listKey] = listConfig;
      } catch (error) {
        console.warn(`Error parsing YAML file ${file}:`, error.message);
      }
    }
  }

  return listsConfig;
}


module.exports = function () {
  const faqData = data().faqsByCategory;
  const curatedListsConfig = loadCuratedListsFromYAML();
  const result = [];

  for (const [listKey, listConfig] of Object.entries(curatedListsConfig)) {
    const listItems = [];

    for (const faqRef of listConfig.faqs) {
      let category, filename;

      const parts = faqRef.split('/');
      if (parts.length === 2) {
        category = parts[0];
        filename = parts[1] + '.md'; // Add .md extension
      } else {
        throw new Error(`Invalid FAQ reference format: ${faqRef}. Expected "category/filename"`);
      }
  
      // Find the FAQ item in the data
      const categoryItems = faqData[category];
      if (categoryItems) {
        const faqItem = categoryItems.find(item => item.filename === filename);
        if (faqItem) {
          listItems.push({
            ...faqItem,
            category: category
          });
        }
      }
    }

    result.push({
      key: listKey,
      value: {
        ...listConfig,
        items: listItems,
        count: listItems.length
      }
    });
  }

  return result;
};
