import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeKeywordCoverage,
  buildKeywordSuggestionPrompts,
  buildNotePrompts,
  noteToMarkdown,
  noteToPublishText,
  parseKeywordList,
  parseKeywordSuggestionOutput,
  parseNoteModelOutput,
  sanitizeNoteTitle,
  titleWeightedLength,
  validateNoteRequest,
} from "../public/note-writing.js";

const source = `第1页
页面标题：小学数学课件
页面文字：
这是一套面向五年级课堂使用的数学课件，包含概念讲解、课堂练习和课后复习。

第2页
页面标题：分数练习
页面文字：
通过例题帮助学生理解分数的基本概念，并安排课堂练习。`;

test("parseKeywordList 支持中英文分隔符并去重", () => {
  assert.deepEqual(parseKeywordList("小学数学PPT，老师备课\n小学数学PPT;课堂练习"), [
    "小学数学PPT",
    "老师备课",
    "课堂练习",
  ]);
});

test("validateNoteRequest 允许长尾关键词留空并限制最多8个", () => {
  const result = validateNoteRequest({
    source,
    coreKeyword: "小学数学PPT",
    longTailKeywords: "",
  });
  assert.deepEqual(result.longTailKeywords, []);
  assert.equal(result.targetLength, "350-550");
  assert.throws(
    () =>
      validateNoteRequest({
        source,
        coreKeyword: "小学数学PPT",
        longTailKeywords: Array.from({ length: 9 }, (_, index) => `关键词内容${index + 1}`).join("\n"),
      }),
    /最多填写 8 个/,
  );
});

test("buildNotePrompts 使用单一种草角度并禁止逐页复述和置顶评论", () => {
  const prompts = buildNotePrompts({
    source,
    sourceTitle: "五年级数学",
    coreKeyword: "小学数学PPT",
    longTailKeywords: "小学数学PPT怎么做\n五年级数学课件",
    noteType: "painpoint",
    audience: "刚入职的新老师",
    audiencePain: "备课时间紧",
  });
  assert.match(prompts.instructions, /唯一事实来源/);
  assert.match(prompts.instructions, /只选2至4个/);
  assert.match(prompts.instructions, /禁止按PPT页码或模块顺序逐段复述/);
  assert.match(prompts.instructions, /总长度不得超过20字/);
  assert.match(prompts.instructions, /不要输出置顶评论字段/);
  assert.match(prompts.input, /<读者痛点>备课时间紧<\/读者痛点>/);
  assert.match(prompts.input, /<核心关键词>小学数学PPT<\/核心关键词>/);
});

test("标题按emoji两字计数并自动去标点截断", () => {
  assert.equal(titleWeightedLength("语文课🔥"), 5);
  const title = sanitizeNoteTitle("七年级语文开学第一课：原来要这样讲🔥真的很实用");
  assert.ok(titleWeightedLength(title) <= 20);
  assert.doesNotMatch(title, /[：，。！？]/u);
});

test("parseNoteModelOutput 规范标题标签和大字报文案且忽略置顶评论", () => {
  const note = parseNoteModelOutput(`\`\`\`json
  {"titles":["标题一！","标题二🔥","标题三"],"body":"小学数学PPT正文","posterText":"不是讲得多而是讲得准","imagePlan":["封面页"],"hashtags":["数学课件"],"pinnedComment":"不应保留","factBasis":[{"fact":"五年级","source":"第1页"}]}
  \`\`\``);
  assert.equal(note.titles[0], "标题一");
  assert.equal(note.posterText, "不是讲得多而是讲得准");
  assert.deepEqual(note.hashtags, ["#数学课件"]);
  assert.equal(note.factBasis[0].source, "第1页");
  assert.equal("pinnedComment" in note, false);
});

test("analyzeKeywordCoverage 长尾词留空时只检查核心关键词", () => {
  const note = {
    titles: ["小学数学PPT备课思路"],
    body: "这是一份五年级课堂使用的内容。",
    posterText: "不是做得多而是做得准",
    hashtags: ["#小学数学PPT"],
  };
  const coverage = analyzeKeywordCoverage(note, "小学数学PPT", []);
  assert.equal(coverage.coreFound, true);
  assert.deepEqual(coverage.missingLongTail, []);
  assert.equal(coverage.passed, true);
});

test("关键词推荐只依据课件并解析最多8个词", () => {
  const prompts = buildKeywordSuggestionPrompts({
    source,
    sourceTitle: "五年级数学",
    coreKeyword: "小学数学PPT",
    audience: "一线老师",
    audiencePain: "备课时间紧",
  });
  assert.match(prompts.instructions, /不得虚构平台数据/);
  assert.match(prompts.input, /<课件依据>/);
  const keywords = parseKeywordSuggestionOutput(
    '{"keywords":["五年级数学课件","老师快速备课","小学数学PPT"]}',
    "小学数学PPT",
  );
  assert.deepEqual(keywords, ["五年级数学课件", "老师快速备课"]);
});

test("发布文本只有标题正文标签且不含字段前缀", () => {
  const note = {
    titles: ["选中标题"],
    body: "正文内容",
    hashtags: ["#课件", "#老师备课"],
    posterText: "大字报文案",
    imagePlan: ["封面页"],
  };
  const text = noteToPublishText(note);
  assert.equal(text, "选中标题\n\n正文内容\n\n#课件 #老师备课");
  assert.doesNotMatch(text, /标题：|正文：|标签：|大字报|配图顺序/);
  assert.equal(noteToMarkdown(note), text);
});
