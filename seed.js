// First-run data: the recipe library and a starting week, loaded once into IndexedDB.
// Protein per serving is left blank for Brad to fill in (the app asks the first time a meal is logged).
// Edit freely; changes here only affect a fresh install (or after clearing the app's data).
window.SEED = {
  // key: used only inside this file. unit: default unit. local: bought from a local producer.
  ingredients: [
    { key: 'rice', name: 'Jasmine rice', unit: 'g', store: 'Costco', aisle: 'Pantry' },
    { key: 'berries', name: 'Frozen mixed berries', unit: 'g', store: 'Costco', aisle: 'Frozen' },
    { key: 'bulgogi', name: 'Costco beef bulgogi', unit: 'pack', store: 'Costco', aisle: 'Ready meals' },
    { key: 'butterChicken', name: 'Costco butter chicken', unit: 'pack', store: 'Costco', aisle: 'Ready meals' },
    { key: 'dumplings', name: 'Frozen dumplings', unit: 'pack', store: 'Costco', aisle: 'Frozen' },

    { key: 'turkeyMince', name: 'Turkey mince', unit: 'g', store: 'Butcher', aisle: 'Meat', local: true },
    { key: 'chickenThigh', name: 'Chicken thigh fillets', unit: 'g', store: 'Butcher', aisle: 'Meat', local: true },
    { key: 'chickenBreast', name: 'Chicken breast', unit: 'g', store: 'Butcher', aisle: 'Meat', local: true },

    { key: 'onion', name: 'Brown onion', unit: 'each', store: 'Market', aisle: 'Veg', local: true },
    { key: 'redOnion', name: 'Red onion', unit: 'each', store: 'Market', aisle: 'Veg', local: true },
    { key: 'carrot', name: 'Carrot', unit: 'each', store: 'Market', aisle: 'Veg', local: true },
    { key: 'garlic', name: 'Garlic (head)', unit: 'each', store: 'Market', aisle: 'Veg', local: true },
    { key: 'capsicum', name: 'Capsicum', unit: 'each', store: 'Market', aisle: 'Veg', local: true },
    { key: 'sweetPotato', name: 'Sweet potato', unit: 'g', store: 'Market', aisle: 'Veg', local: true },
    { key: 'broccoli', name: 'Broccoli', unit: 'each', store: 'Market', aisle: 'Veg', local: true },
    { key: 'bokChoy', name: 'Bok choy', unit: 'bunch', store: 'Market', aisle: 'Veg', local: true },
    { key: 'springOnion', name: 'Spring onions', unit: 'bunch', store: 'Market', aisle: 'Veg', local: true },
    { key: 'avocado', name: 'Avocado', unit: 'each', store: 'Market', aisle: 'Fruit', local: true },
    { key: 'lime', name: 'Lime', unit: 'each', store: 'Market', aisle: 'Fruit', local: true },
    { key: 'banana', name: 'Banana', unit: 'each', store: 'Market', aisle: 'Fruit', local: true },

    { key: 'steelOats', name: 'Steel-cut oats', unit: 'g', store: 'Supermarket', aisle: 'Cereal' },
    { key: 'rolledOats', name: 'Rolled oats', unit: 'g', store: 'Supermarket', aisle: 'Cereal' },
    { key: 'wpi', name: 'WPI protein powder', unit: 'g', store: 'Supermarket', aisle: 'Health food' },
    { key: 'oatly', name: 'Oatly', unit: 'ml', store: 'Supermarket', aisle: 'Dairy & alternatives' },
    { key: 'parmesan', name: 'Parmesan', unit: 'g', store: 'Supermarket', aisle: 'Dairy & alternatives' },
    { key: 'lentils', name: 'Red lentils', unit: 'g', store: 'Supermarket', aisle: 'Pantry' },
    { key: 'passata', name: 'Passata', unit: 'g', store: 'Supermarket', aisle: 'Pantry' },
    { key: 'spaghetti', name: 'Spaghetti', unit: 'g', store: 'Supermarket', aisle: 'Pantry' },
    { key: 'pastaShells', name: 'Pasta shells', unit: 'g', store: 'Supermarket', aisle: 'Pantry' },
    { key: 'blackBeans', name: 'Black beans', unit: 'tin', store: 'Supermarket', aisle: 'Pantry' },
    { key: 'corn', name: 'Corn kernels', unit: 'tin', store: 'Supermarket', aisle: 'Pantry' },
    { key: 'tuna', name: 'Tuna in springwater (425 g)', unit: 'tin', store: 'Supermarket', aisle: 'Pantry' },
    { key: 'cornflour', name: 'Cornflour', unit: 'g', store: 'Supermarket', aisle: 'Pantry' },
    { key: 'soy', name: 'Soy sauce', unit: 'ml', store: 'Supermarket', aisle: 'Pantry' },
    { key: 'oliveOil', name: 'Olive oil', unit: 'ml', store: 'Supermarket', aisle: 'Pantry' },
    { key: 'peasCorn', name: 'Frozen peas and corn', unit: 'g', store: 'Supermarket', aisle: 'Frozen' },
    { key: 'peas', name: 'Frozen peas', unit: 'g', store: 'Supermarket', aisle: 'Frozen' },

    // Home-made and backyard; kept in the pantry, so they only reach the list when stock runs short.
    { key: 'eggs', name: 'Eggs', unit: 'each', store: 'Supermarket', aisle: 'Eggs', pantryKey: 'eggs' },
    { key: 'sourdough', name: 'Sourdough', unit: 'loaf', store: 'Supermarket', aisle: 'Bakery', pantryKey: 'sourdough' },
    { key: 'butter', name: 'Homemade butter', unit: 'g', store: 'Supermarket', aisle: 'Dairy & alternatives' },
  ],

  // ingredients: [key, qty, unit] for the whole recipe (all servings).
  recipes: [
    { name: 'Steel-cut oats, WPI, berries', servings: 1, tags: ['rice cooker', 'quick'], lactose: 'none',
      method: 'Night before: oats and 300 ml water in the rice cooker, porridge setting on the timer.\nMorning: stir through the WPI and Oatly, top with berries.',
      ingredients: [['steelOats', 80, 'g'], ['wpi', 30, 'g'], ['berries', 100, 'g'], ['oatly', 150, 'ml']] },
    { name: 'Turkey and lentil bolognese', servings: 6, tags: ['batch'], lactose: 'none',
      method: 'Brown the mince, add onion, carrot and garlic. Add lentils, passata and 500 ml water; simmer 40 min.\nPortion into 6 containers; freeze what won\'t be eaten in 3 days.',
      ingredients: [['turkeyMince', 1000, 'g'], ['lentils', 200, 'g'], ['passata', 700, 'g'], ['onion', 2, 'each'], ['carrot', 2, 'each'], ['garlic', 1, 'each'], ['spaghetti', 500, 'g']] },
    { name: 'Chilli-lime chicken burrito bowl', servings: 4, tags: ['batch'], lactose: 'none',
      method: 'Marinate chicken in lime juice, chilli and garlic; grill and slice. Serve over rice with beans, corn, capsicum and avocado.',
      ingredients: [['chickenThigh', 1000, 'g'], ['rice', 300, 'g'], ['blackBeans', 2, 'tin'], ['corn', 1, 'tin'], ['capsicum', 2, 'each'], ['lime', 2, 'each'], ['avocado', 2, 'each']] },
    { name: 'Costco bulgogi with rice', servings: 4, tags: ['Costco ready-meal', 'rice cooker'], lactose: 'none',
      method: 'Check the label for milk solids.\nRice in the rice cooker; pan-fry the bulgogi.',
      ingredients: [['bulgogi', 1, 'pack'], ['rice', 300, 'g']] },
    { name: 'Egg fried rice', servings: 2, tags: ['quick', 'cook once eat twice'], lactose: 'none',
      method: 'Best with day-old rice. Scramble the eggs, add rice, peas and corn, soy sauce; finish with spring onion.',
      ingredients: [['eggs', 4, 'each'], ['rice', 200, 'g'], ['peasCorn', 200, 'g'], ['soy', 30, 'ml'], ['springOnion', 1, 'bunch']] },
    { name: 'Tuna mornay', servings: 4, tags: ['cook once eat twice'], lactose: 'low',
      method: 'White sauce with Oatly and cornflour; stir in tuna, peas and cooked pasta. Top with parmesan and bake 15 min.',
      ingredients: [['tuna', 2, 'tin'], ['pastaShells', 400, 'g'], ['peas', 200, 'g'], ['oatly', 500, 'ml'], ['cornflour', 30, 'g'], ['parmesan', 40, 'g'], ['onion', 1, 'each']] },
    { name: 'Costco butter chicken with rice', servings: 4, tags: ['Costco ready-meal', 'rice cooker'], lactose: 'contains',
      method: 'Contains cream. Rice in the rice cooker; heat the butter chicken.',
      ingredients: [['butterChicken', 1, 'pack'], ['rice', 300, 'g']] },
    { name: 'Rice-cooker dumplings, Asian greens', servings: 2, tags: ['rice cooker', 'quick'], lactose: 'contains',
      method: 'Check the dumpling label and change the lactose flag to "none" if it\'s clear.\nSteam dumplings in the rice cooker basket; add bok choy for the last 5 min. Soy to serve.',
      ingredients: [['dumplings', 1, 'pack'], ['bokChoy', 2, 'bunch'], ['soy', 20, 'ml']] },
    { name: 'Sheet-pan chicken and veg', servings: 4, tags: ['cook once eat twice'], lactose: 'none',
      method: 'Everything on one tray with olive oil and seasoning, 200 °C for 35 min.',
      ingredients: [['chickenBreast', 800, 'g'], ['sweetPotato', 600, 'g'], ['broccoli', 2, 'each'], ['redOnion', 1, 'each'], ['capsicum', 1, 'each'], ['oliveOil', 30, 'ml']] },
    { name: 'Protein pancakes', servings: 1, tags: ['quick'], lactose: 'none',
      method: 'Blend everything; cook small pancakes in a hot non-stick pan.',
      ingredients: [['wpi', 30, 'g'], ['eggs', 2, 'each'], ['rolledOats', 40, 'g'], ['banana', 1, 'each'], ['oatly', 60, 'ml']] },
    { name: 'Eggs on sourdough', servings: 1, tags: ['quick'], lactose: 'none',
      method: '3 eggs any style on 2 slices of sourdough.',
      ingredients: [['eggs', 3, 'each'], ['sourdough', 0.2, 'loaf']] },
    { name: 'Post-workout shake (WPI, Oatly)', servings: 1, tags: ['quick'], lactose: 'low', shake: true,
      method: 'WPI is an isolate, so very low lactose.',
      ingredients: [['wpi', 30, 'g'], ['oatly', 300, 'ml']] },
  ],

  // A starting week, saved as a template (Week → Use template). Training follows Lift Log's schedule.
  // A slot is { recipe, cook } (cook = servings to make; defaults to the whole recipe),
  // { leftover: [dayIndex 0 = Mon, slot], freezer } or { text }.
  template: {
    name: 'Standard week',
    days: [
      { training: 'lift', slots: {
        breakfast: { recipe: 'Steel-cut oats, WPI, berries' },
        lunch: { recipe: 'Turkey and lentil bolognese' },
        dinner: { recipe: 'Chilli-lime chicken burrito bowl' },
        snack: { recipe: 'Post-workout shake (WPI, Oatly)' } } },
      { training: 'walk', slots: {
        breakfast: { recipe: 'Steel-cut oats, WPI, berries' },
        lunch: { leftover: [0, 'dinner'] },
        dinner: { recipe: 'Egg fried rice' } } },
      { training: 'lift', slots: {
        breakfast: { recipe: 'Steel-cut oats, WPI, berries' },
        lunch: { leftover: [1, 'dinner'] },
        dinner: { leftover: [0, 'lunch'] },
        snack: { recipe: 'Post-workout shake (WPI, Oatly)' } } },
      { training: 'hiit', slots: {
        breakfast: { recipe: 'Steel-cut oats, WPI, berries' },
        lunch: { leftover: [0, 'dinner'] },
        dinner: { recipe: 'Costco bulgogi with rice' } } },
      { training: 'lift', slots: {
        breakfast: { recipe: 'Steel-cut oats, WPI, berries' },
        lunch: { leftover: [3, 'dinner'] },
        dinner: { recipe: 'Sheet-pan chicken and veg' },
        snack: { recipe: 'Post-workout shake (WPI, Oatly)' } } },
      { training: 'rest', slots: {
        breakfast: { recipe: 'Eggs on sourdough' },
        lunch: { leftover: [4, 'dinner'] },
        dinner: { leftover: [0, 'lunch'], freezer: true } } },
      { training: 'rest', slots: {
        breakfast: { recipe: 'Protein pancakes' },
        lunch: { recipe: 'Rice-cooker dumplings, Asian greens' },
        dinner: { recipe: 'Tuna mornay' } } },
    ],
  },

  // Starting pantry: [key, qty, unit]. Set real amounts in the Pantry tab.
  pantry: [['eggs', 0, 'each'], ['sourdough', 0, 'loaf'], ['butter', 0, 'g']],
};
