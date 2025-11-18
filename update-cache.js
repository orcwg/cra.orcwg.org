const {execSync} = require ('child_process');
const fs = require ('fs');
const path = require('path');

const REPO_URL= "https://github.com/orcwg/cra-hub.git"
const BRANCH= process.argv[2] || "main";
const CACHE_DIR = "_cache"

if (fs.existsSync(path.join(CACHE_DIR, ".git"))) {
  console.log(`🔄 Updating cache (branch: ${BRANCH})...`);
  
  process.chdir(CACHE_DIR);

  execSync('git fetch origin');
  execSync(`git checkout ${BRANCH}`);
  execSync(`git pull --rebase origin ${BRANCH}`);

  process.chdir('..');
}
else {
  console.log(`📥 Cloning repo (branch: ${BRANCH})...`);
  execSync(`git clone --branch ${BRANCH} ${REPO_URL} ${CACHE_DIR}`);
}