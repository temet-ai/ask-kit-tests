// Who is on duty at each Watch House. Cable Street is one officer short on purpose.
const posts = { "Pseudopolis Yard": ["Sam Vimes"], "Cable Street": ["Angua"] };

export const onDuty = (post) => {
  if (!posts[post]) throw new Error(`no post ${post}`);
  return posts[post];
};
