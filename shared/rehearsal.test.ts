import { describe, expect, it } from "vitest";
import {
  containsCommitment,
  isCommitmentQuestion,
  topRehearsalActs,
} from "./rehearsal";

describe("isCommitmentQuestion", () => {
  it("recognises the questions only the person can answer", () => {
    for (const line of [
      "你还爱我吗",
      "能原谅我吗",
      "我们还能复合吗",
      "你愿不愿意再试一次",
      "你会不会回来",
      "你是不是不要我了",
      "do you still love me",
      "will you forgive me",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(true);
    }
  });

  it("recognises the manual's list in the words people actually type (C3.2)", () => {
    // The manual names the class — 还爱不爱, 原不原谅, 要不要复合,
    // 愿不愿意, 会不会回来, 是不是不要我了, and their English
    // counterparts. The first table only caught the phrasings written
    // down; these are the same questions in other words.
    for (const line of [
      "你爱不爱我",
      "你原不原谅我",
      "你要不要复合",
      "你愿不愿意再给我一次机会",
      "你还会不会回来",
      "你是不是已经不想要我了",
      "do you love me",
      "can you forgive me",
      "will you come back",
      "do you still want me",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(true);
    }
  });

  it("recognises the phrasings the acceptance found missed (C3.2)", () => {
    // Marriage proposals, "give me another chance" demands, and the
    // English "is it over" family. The room used to generate three
    // possibilities for these instead of refusing before any model call.
    for (const line of [
      "你会不会娶我",
      "我们结婚吧",
      "你愿意嫁给我吗",
      "我想和你结婚",
      "能不能给我一次机会",
      "再给我一次机会好吗",
      "你会等我吗",
      "你还会回来吗",
      "你还在乎我吗",
      "我们和好吧",
      "原谅我吧",
      "is it over",
      "give me another chance",
      "will you wait for me",
      "do you still care",
      "do you want me back",
      "would you take me back",
      "can we get back together",
      "are we over",
      "will you marry me",
      "let's get married",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(true);
    }
  });

  it("recognises a proposal or an ending question with the subject dropped (C3.2)", () => {
    // The first table needed a 你/您 before 嫁 and a question marker
    // directly after 结婚, so the same questions typed the way people
    // actually say them came back as no question at all; the Chinese
    // ending family had no pattern whatsoever.
    for (const line of [
      "嫁给我好吗",
      "嫁给我吧",
      "愿意嫁给我吗",
      "我们结婚好吗",
      "我们结婚好不好",
      "我们领证好吗",
      "我们办婚礼好吗",
      "是不是结束了",
      "我们是不是结束了",
      "我们结束了吗",
      "我们是不是要分手",
      "marry me",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(true);
    }
  });

  it("keeps the 陪我 promises that were a verdict before the third fix (C3.2)", () => {
    // The third fix narrowed 陪我 to the end of the sentence and dropped
    // 陪 from the "回来找我" family, so these went back to the
    // generation path. They are promises about the relationship, not a
    // request for the day ("陪我逛街" / "回来陪我吃饭" stay out).
    for (const line of [
      "你会不会陪我到老",
      "你能不能陪我到老",
      "你愿不愿意留下来陪我",
      "你会不会留下来陪我",
      "你回来陪我吗",
      "你回来陪我吧",
      "你什么时候回来陪我",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(true);
    }
  });

  it("recognises the same ending question with 该 / 快 and the proposal with 行 / 可以 (C3.2)", () => {
    // The ending pattern only knew 是不是/是否 directly before the verb,
    // and the proposal only knew a particle directly after 嫁给我.
    for (const line of [
      "我们是不是该结束了",
      "我们是不是该分手了",
      "我们该不该结束了",
      "我们是不是快要结束了",
      "嫁给我行吗",
      "嫁给我可以吗",
      "嫁给我，好吗",
      "嫁给我成吗",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(true);
    }
  });

  it("does not treat a movie, an exam, a match or someone else's break-up as a verdict (C3.2)", () => {
    // The 结束/分手 family is also used for things and other people: a
    // rehearsal of "电影是不是结束了" is a normal line, not a question
    // whose answer belongs to the persona.
    for (const line of [
      "电影是不是结束了",
      "这部剧是不是结束了",
      "考试是不是结束了",
      "比赛结束了吗",
      "他是不是分手了",
      "我朋友是不是分手了",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(false);
    }
  });

  it("keeps the English daily questions apart from the relationship ones (C3.2 round 5)", () => {
    // The English half of the ending/reply tables was widened in round
    // five; without an object bound it caught "end this meeting",
    // "break up the team" and "we are done with the report".
    for (const line of [
      "should we end this call?",
      "should we end this meeting early?",
      "can we end this quickly?",
      "do we end this chapter here?",
      "should we break up the team into groups?",
      "should we break up the work into two parts?",
      "should we split up the bill?",
      "will we end this semester early?",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(false);
    }
    for (const line of ["should we break up?", "should we split up?"]) {
      expect(isCommitmentQuestion(line), line).toBe(true);
    }
    // A plain modal is a statement; the question form needs a particle,
    // and the particle forms of 陪我到老 include 对吧/是吧.
    for (const line of ["你会一直陪着我", "你会永远陪着我", "你会陪我到老"]) {
      expect(isCommitmentQuestion(line), line).toBe(false);
    }
    for (const line of ["你会一直陪着我吗", "你会陪我到老吗", "你陪我到老，对吧", "你陪我到老是吧"]) {
      expect(isCommitmentQuestion(line), line).toBe(true);
    }
    for (const reply of [
      "we are done with the report",
      "we are done for today",
      "we are done for now",
      "We should end this meeting before six.",
      "We should break up the task into steps.",
    ]) {
      expect(containsCommitment(reply), reply).toBe(false);
    }
    for (const reply of ["we are done.", "we are over", "we should break up.", "we should end this.", "我们到此结束吧"]) {
      expect(containsCommitment(reply), reply).toBe(true);
    }
  });

  it("does not treat an ordinary question as a verdict", () => {
    for (const line of [
      "我今天很想你",
      "对不起 那天我不该那样说",
      "你今天忙吗",
      "晚安",
      // The widened table must not swallow ordinary words: a wedding is
      // something one attends, "love" takes an object, and "回来" is
      // followed by another verb in a schedule question.
      "今天去参加朋友的婚礼",
      "我们参加婚礼吧",
      "他在婚礼上哭了",
      "I love this song",
      "I love this movie",
      "你会回来吃饭吗",
      "你什么时候回来",
      "你愿意给我带杯咖啡吗",
      "我好喜欢这首歌",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(false);
    }
  });

  it("does not mistake a daily request for a question about the relationship (C3.2)", () => {
    // The widened table used to catch these: "陪我" and "留下" are only a
    // verdict when nothing follows them, and "回来陪我吃饭" is a
    // schedule, not "come back to me". A rehearsal of them must still
    // generate.
    for (const line of [
      "你能不能陪我逛街",
      "你会不会陪我逛街",
      "你能不能留下来吃饭",
      "你回来陪我吃饭吗",
      "你能陪我逛街吗",
      "你陪我逛街吧",
      "你回来陪我看电影",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(false);
    }
  });

  it("does not treat a daily sentence that borrows 陪我 / 快要 as a question (C3.2 round 5)", () => {
    // The fourth fix made any sentence ending in 陪我 a verdict and put
    // 快要 into the ending question markers, so third-person statements,
    // thanks, and "the summer is almost over" were refused before any
    // model call. These are ordinary lines; the room must still generate.
    for (const line of [
      "他一直陪我",
      "妈妈每天陪我",
      "谢谢你来陪我",
      "谢谢你陪我到老",
      "他陪我到老",
      "你昨天陪我",
      "你今晚陪我吗",
      "你能陪我吗",
      "我们快要结束了",
      "我们快要分手了",
      "我们快要结束异地了",
      "暑假快要结束了",
      "我们考试结束了吗",
      "我们比赛结束了吗",
      "暑假结束了吗",
      "展会结束了吗",
      "我们公司是不是结束了",
      "饭局结束了吗",
      // The same class in the other direction: a request to end the
      // topic/trip/call is about the thing, not the relationship, and a
      // marriage statement is not a question.
      "我们能不能结束这个话题",
      "能不能结束这个话题",
      "我们可不可以结束这场讨论",
      "我们能不能结束这次争吵",
      "我们能不能早点结束",
      "你会和我结婚的",
      "你会和我结婚以后住哪里",
      "你愿意和我结婚",
      "谢谢你陪我",
      "谢谢你一直陪我",
      "他会陪我到老",
      "他说他会陪我到老",
      "我希望你陪我到老",
      "他每天都陪我",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(false);
    }
  });

  it("recognises the same-family questions still missed at round four (C3.2 round 5)", () => {
    for (const line of [
      "你会回来陪我吗",
      "你会和我结婚吗",
      "你会一直陪着我吗",
      "你陪我到老好不好",
      "你陪我到老行吗",
      "你陪我到老可以吗",
      "你陪我到老，好吗",
      "should we break up",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(true);
    }
  });

  it("does not treat a statement about the relationship as a question (C3.2)", () => {
    // "我们结束了" is the user saying it, not asking it, and
    // "我们结婚好几年了" only borrows the marriage word. "我们分手吧"
    // is a proposal to rehearse — the reply gate (containsCommitment)
    // covers what the model may answer, not this first gate.
    for (const line of [
      "我们结束了",
      "我们结婚好几年了",
      "我们分手吧",
      "我们结束吧",
      "我们分开吧",
      "我们快要结束了",
      "我们快要分手了",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(false);
    }
  });
});

describe("containsCommitment", () => {
  it("catches a reply that promises or decides", () => {
    for (const reply of [
      "我原谅你",
      "我们复合吧",
      "我答应你",
      "我还爱你",
      "我不爱你了",
      "我们分手吧",
      "我不会离开你",
      "我会娶你",
      "我们结婚吧",
      "我永远都在",
      "i forgive you",
    ]) {
      expect(containsCommitment(reply), reply).toBe(true);
    }
  });

  it("catches the second-gate phrasings that answer for the person (C3.2)", () => {
    /**
     * The first gate refuses the question; the second stops the model
     * from promising in the retry. The retry guard used to know only the
     * manual's own examples, so the same promise in other words got
     * through. These all decide something only the real person may
     * decide.
     */
    for (const reply of [
      "我会原谅你",
      "我决定原谅你",
      "我愿意再试一次",
      "我同意和好",
      "我决定分手",
      "我们重新开始吧",
      "我不恨你了",
      "我会等你",
      "我一直陪着你",
      "我给你一次机会",
      "我依然爱你",
      "我们在一起吧",
      "我们分开吧",
      "我们还是做朋友吧",
      "I'll give you another chance",
      "I'll wait for you",
      "I still have feelings for you",
      "we can start over",
      "let's try again",
      "I'm not angry anymore",
      "I'll always love you",
      "I'll marry you",
      "let's get married",
      "I promise",
    ]) {
      expect(containsCommitment(reply), reply).toBe(true);
    }
  });

  it("catches the marriage promises the acceptance found passing the second gate (C3.2)", () => {
    /**
     * The retry could still answer for the person when the promise was a
     * marriage rather than one of the manual's examples: the old table
     * wanted `我娶你`/`我嫁给你` or `我们结婚` followed by a particle. A
     * reply that decides the marriage for them must be dropped.
     */
    for (const reply of [
      "我会和你结婚",
      "我决定和你结婚",
      "我会跟你结婚",
      "我们领证吧",
      "我们办婚礼吧",
      "我们会结婚的",
      "我接受你的求婚",
      "我答应嫁给你",
    ]) {
      expect(containsCommitment(reply), reply).toBe(true);
    }
  });

  it("catches the ending promises the retry could still answer for the person (C3.2 round 5)", () => {
    // The first gate now lets a statement/proposal through on purpose
    // ("我们分手吧" is the user's line to rehearse); the second gate has
    // to stop the model from answering it with a decision of its own.
    for (const reply of [
      "我们结束了",
      "我们结束吧",
      "我们该结束了",
      "我们分开吧",
      "我们离婚吧",
      "我们结束这段关系吧",
      "我们结束这段感情吧",
      "we are over",
      "we should break up",
    ]) {
      expect(containsCommitment(reply), reply).toBe(true);
    }
  });

  it("lets an ordinary reply through", () => {
    for (const reply of [
      "嗯",
      "我在",
      "今天好累",
      "我也想你了",
      "晚安",
      "I love this song",
      "今天去参加朋友的婚礼",
      "我最近在学做饭",
      "这首歌真好听",
      "我们分手了吗",
    ]) {
      expect(containsCommitment(reply), reply).toBe(false);
    }
  });
});

describe("topRehearsalActs", () => {
  it("takes the three most likely acts above the floor", () => {
    const result = topRehearsalActs({
      acknowledge: 40,
      comfort: 30,
      deflect: 20,
      tease: 5,
      silence: 5,
    });
    expect(result.map((entry) => entry.act)).toEqual(["acknowledge", "comfort", "deflect"]);
    expect(result.every((entry) => entry.share >= 0.1)).toBe(true);
  });

  it("does not add up past one after rounding", () => {
    const result = topRehearsalActs({ acknowledge: 34, comfort: 33, silence: 33 });
    const total = result.reduce((sum, entry) => sum + entry.share, 0);
    expect(total).toBeLessThanOrEqual(1);
  });

  it("returns nothing for an empty distribution", () => {
    expect(topRehearsalActs(null)).toEqual([]);
    expect(topRehearsalActs({})).toEqual([]);
    expect(topRehearsalActs({ silence: 0 })).toEqual([]);
  });
});
