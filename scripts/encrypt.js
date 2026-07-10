// 建置時加密：PBKDF2(密碼)->AES-256-GCM 加密題庫資料，與瀏覽器 WebCrypto 相容
// 用法: node encrypt.js <dataJsonPath> <templatePath> <outHtmlPath> <password>
const fs = require('fs'), crypto = require('crypto');
const [, , dataPath, tplPath, outPath, password] = process.argv;

const plain = fs.readFileSync(dataPath);            // UTF-8 JSON bytes
const salt = crypto.randomBytes(16);
const iter = 150000;
const key = crypto.pbkdf2Sync(password, salt, iter, 32, 'sha256');
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
const tag = cipher.getAuthTag();
// WebCrypto AES-GCM 解密要求 ciphertext 後接 16-byte tag
const ctTag = Buffer.concat([ct, tag]);

const enc = {
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  ct: ctTag.toString('base64'),
  iter: iter,
};
const tpl = fs.readFileSync(tplPath, 'utf8');
const html = tpl.replace('/*__DATA__*/', 'window.ENC=' + JSON.stringify(enc) + ';');
fs.writeFileSync(outPath, html);
console.log('加密完成：明文 %d KB -> 密文 %d KB', plain.length >> 10, ctTag.length >> 10);
