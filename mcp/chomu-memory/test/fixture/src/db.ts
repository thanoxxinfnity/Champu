const users = [{ id: 1, email: 'a@b.c', hash: 'x' }];

export const db = {
  async findUser(email: string) {
    return users.find((u) => u.email === email);
  },
  dropSession(token: string) {
    return token.length;
  },
};
