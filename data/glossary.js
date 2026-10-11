// Cached help for the demo passages (project document 8.1: "cached for the demo") and an offline fallback.
// When the optional language-model backend is running, it gives meanings from the sentence itself;
// when it is not, BlinkBrief falls back to this list. Meanings are written in plain words.
(function (root) {
  const MEANINGS = {
    scientist: "A person who studies the world by testing ideas and doing experiments.",
    careful: "Taking time and paying attention so you do not make mistakes.",
    thorough: "Complete. Nothing is missed or left out.",
    thoroughly: "In a complete way, with nothing left out. Here it means \"very much\".",
    certain: "Sure. You have no doubt.",
    results: "What you find out at the end of a test or a check.",
    harbour: "A safe place by the sea where boats stay.",
    nets: "Nets are made of string with holes. Fishermen use them to catch fish.",
    tear: "Here it means a hole or a rip (said \"tair\"). A tear in the eye is said \"teer\".",
    single: "Only one.",
    appeared: "Came into view. You could see it.",
    gently: "In a soft, calm way.",
    wooden: "Made of wood.",
    enormous: "Very, very big.",
    glacier: "A huge river of ice that moves very slowly down a mountain.",
    glaciers: "Huge rivers of ice that move very slowly down mountains.",
    narrow: "Not wide. There is only a little space from side to side.",
    steep: "Going up very sharply, like a steep hill.",
    explained: "Told someone about something so they could understand it.",
    amazed: "Very surprised and full of wonder.",
    mysterious: "Strange. Hard to understand or explain.",
    developmental: "To do with how a person grows and changes over time.",
    dyslexia: "A difference in the brain that can make reading and spelling harder.",
    disruption: "Something that gets in the way and stops things from going smoothly.",
    accurate: "Correct. With no mistakes.",
    decoding: "Working out how to say a written word by sounding out its letters.",
    cognitive: "To do with thinking and learning.",
    exhaustion: "Feeling extremely tired.",
    profound: "Very deep or very strong.",
    complex: "Made of many parts. Hard to understand.",
    structures: "The way things are built or put together.",
    assistance: "Help.",
    unfamiliar: "Not known to you. You have not seen it before.",
    pauses: "Stops for a short time.",
    different: "Not the same.",
    support: "Help.",
  };

  // [original, easier] pairs for the demo sentences. Any sentence not listed is simplified by simple rules
  // (see js/api.js) or, if the backend is running, by the language model.
  const EASIER = [
    ["The scientist made a careful, thorough check of the results.", "The scientist checked the results very carefully."],
    ["She wanted to be certain before she told anyone.", "She wanted to be sure before she told anyone."],
    ["Every morning, the fisherman walked to the harbour before the sun appeared.", "Each morning, the fisherman walked to the port before the sun came up."],
    ["The water was calm, and the boats rocked gently against the wooden dock.", "The water was still. The boats moved softly against the wooden pier."],
    ["He checked his nets carefully, because a single tear could mean an empty day.", "He looked at his nets with care. Even one hole could mean no fish that day."],
    ["Last summer, Maya and her uncle went on a long walk in the mountains.", "Last summer, Maya and her uncle went on a long walk in the mountains."],
    ["The path was narrow and steep, and the air grew colder with every step.", "The path was thin and went up sharply. The air got colder with every step."],
    ["Near the top, they found an enormous glacier shining in the sun.", "Near the top, they found a huge river of ice shining in the sun."],
    ["Her uncle explained that glaciers are slow rivers of ice.", "Her uncle told her that glaciers are rivers of ice that move very slowly."],
    ["Maya felt thoroughly amazed, because she had never seen anything so mysterious.", "Maya was very surprised. She had never seen anything so strange."],
    ["Developmental dyslexia causes severe disruption to accurate word decoding.", "Dyslexia can make it hard to read words correctly."],
    ["Readers experience profound cognitive exhaustion when processing complex structures.", "Readers can get very tired in their minds when the text is hard."],
    ["BlinkBrief delivers quiet assistance and fades support over time.", "BlinkBrief gives quiet help, and the help gets smaller over time."],
    ["A reader who pauses on a long unfamiliar word may need a different kind of help.", "A reader who stops on a long new word may need a different kind of help."],
  ];

  // Word swaps for the offline sentence simplifier.
  const SIMPLER = {
    thorough: "complete", thoroughly: "completely", certain: "sure", enormous: "huge", assistance: "help", experience: "feel",
    profound: "deep", exhaustion: "tiredness", complex: "hard", structures: "shapes", accurate: "correct", severe: "serious",
    disruption: "trouble", cognitive: "thinking", unfamiliar: "new", nevertheless: "but", therefore: "so", however: "but",
    approximately: "about", purchase: "buy", commence: "start", terminate: "end", require: "need", obtain: "get",
    sufficient: "enough", numerous: "many", demonstrate: "show", utilize: "use", assist: "help", attempt: "try",
    consequently: "so", additional: "more", difficult: "hard", enormously: "hugely", immense: "huge", mysterious: "strange",
    fascinating: "interesting", extraordinary: "amazing", essential: "needed", prevent: "stop", examine: "look at",
    investigate: "look into", observe: "see", construct: "build", reside: "live", inquire: "ask", residence: "home",
    previously: "before", subsequently: "later", frequently: "often", particularly: "especially", considerable: "large",
    abundant: "plentiful", beneficial: "helpful", comprehend: "understand", conclude: "finish", currently: "now",
  };

  root.BB = root.BB || {};
  root.BB.GLOSSARY = { MEANINGS, EASIER, SIMPLER };
  if (typeof module === "object" && module.exports) module.exports = root.BB.GLOSSARY;
})(typeof self !== "undefined" ? self : this);
