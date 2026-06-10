const fs = require('fs');
const path = require('path');

const KNOWLEDGE_PATH = path.join(__dirname, '../data/knowledge.json');

function readKnowledgeJson() {
    if (!fs.existsSync(KNOWLEDGE_PATH)) {
        throw new Error('File data/knowledge.json tidak ditemukan.');
    }
    return JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'));
}

function readKnowledgeText() {
    try {
        return JSON.stringify(readKnowledgeJson(), null, 2);
    } catch {
        return '(Data desa belum tersedia)';
    }
}

function writeKnowledgeJson(data) {
    fs.writeFileSync(KNOWLEDGE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
    KNOWLEDGE_PATH,
    readKnowledgeJson,
    readKnowledgeText,
    writeKnowledgeJson
};
